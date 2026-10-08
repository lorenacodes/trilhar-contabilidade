// Avisa o cliente por e-mail quando um admin anexa boleto(s) visível(is) a ele.
// Chamada pelo admin.html logo depois do upload. Nunca confia no que o
// navegador mandou: confere no servidor que quem chamou é admin e relê cada
// documento do banco (precisa ser boleto, visível ao cliente, recém-criado e
// ainda não avisado). Boletos do mesmo cliente viram UM e-mail só.
// Envio via API do Resend (domínio trilharcontabilidadese.com.br já
// verificado). Precisa dos secrets RESEND_API_KEY (obrigatório) e, se quiser
// mudar o remetente, RESEND_FROM.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verificarRateLimit(
  adminClient: ReturnType<typeof createClient>,
  chave: string,
  limite: number,
  janelaSegundos: number,
): Promise<boolean> {
  const agora = new Date();
  await adminClient.from("rate_limit_contadores").delete().lt("expira_em", agora.toISOString());
  const { data: existente } = await adminClient
    .from("rate_limit_contadores").select("contagem, expira_em").eq("chave", chave).maybeSingle();
  if (existente && new Date(existente.expira_em) > agora) {
    if (existente.contagem >= limite) return false;
    await adminClient.from("rate_limit_contadores").update({ contagem: existente.contagem + 1 }).eq("chave", chave);
    return true;
  }
  const expiraEm = new Date(agora.getTime() + janelaSegundos * 1000).toISOString();
  await adminClient.from("rate_limit_contadores").upsert({ chave, contagem: 1, expira_em: expiraEm });
  return true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JANELA_RECENTE_MS = 15 * 60 * 1000;
const PORTAL_URL = "https://trilharcontabilidadese.com.br/boletos";

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function brl(v: unknown): string {
  const n = Number(v);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function dataBR(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
function um<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const remetente = Deno.env.get("RESEND_FROM") ?? "Trilhar Contabilidade <naoresponda@trilharcontabilidadese.com.br>";

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: souAdmin, error: adminCheckError } = await callerClient.rpc("is_admin");
    if (adminCheckError || !souAdmin) return jsonResponse({ error: "Apenas administradores podem enviar avisos" }, 403);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    if (!(await verificarRateLimit(adminClient, `notificar-boleto:${ip}`, 20, 60))) {
      return jsonResponse({ error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.documentoIds)
      ? [...new Set(body.documentoIds.map((x: unknown) => String(x)))].filter((x) => UUID_RE.test(x)).slice(0, 50)
      : [];
    if (ids.length === 0) return jsonResponse({ error: "Nenhum boleto informado" }, 400);

    if (!resendKey) {
      console.error("RESEND_API_KEY não configurado nos secrets da Edge Function");
      return jsonResponse({ error: "Envio de e-mail ainda não configurado no servidor" }, 500);
    }

    const { data: docs, error: docsError } = await adminClient
      .from("documentos")
      .select("id, nome, valor, data_vencimento, cliente_id, visivel_cliente, notificado_em, created_at, categorias(eh_boleto, ativa), clientes(users(nome, email, status))")
      .in("id", ids);
    if (docsError) {
      console.error("Falha ao ler documentos:", docsError.message);
      return jsonResponse({ error: "Não foi possível ler os boletos" }, 500);
    }

    const agora = Date.now();
    const elegiveis = (docs ?? []).filter((d) => {
      const cat = um(d.categorias) as { eh_boleto?: boolean; ativa?: boolean } | undefined;
      return cat?.eh_boleto === true && cat?.ativa !== false && d.visivel_cliente === true && !d.notificado_em &&
        (agora - new Date(d.created_at).getTime()) <= JANELA_RECENTE_MS;
    });

    const porCliente = new Map<string, typeof elegiveis>();
    for (const d of elegiveis) {
      const lista = porCliente.get(d.cliente_id) ?? [];
      lista.push(d);
      porCliente.set(d.cliente_id, lista);
    }

    let enviado = false;
    for (const [, lista] of porCliente) {
      const cliente = um(lista[0].clientes) as { users?: unknown } | undefined;
      const usuario = um(cliente?.users as { nome?: string; email?: string; status?: string } | undefined);
      if (!usuario?.email || usuario.status !== "ativo") continue;

      const plural = lista.length > 1;
      const linhasHtml = lista.map((d) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e3e7ef;">${esc(d.nome)}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #e3e7ef;white-space:nowrap;">${esc(brl(d.valor))}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #e3e7ef;white-space:nowrap;">${esc(dataBR(d.data_vencimento))}</td></tr>`
      ).join("");
      const linhasTxt = lista.map((d) => `- ${d.nome} | ${brl(d.valor)} | vence em ${dataBR(d.data_vencimento)}`).join("\n");
      const assunto = plural ? `Novos boletos disponíveis no seu portal (${lista.length})` : "Novo boleto disponível no seu portal";

      const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#161a2b;max-width:560px;margin:0 auto;">
<h2 style="color:#17244a;margin:0 0 12px;">Trilhar Contabilidade</h2>
<p>Olá, ${esc(usuario.nome)}!</p>
<p>${plural ? "Foram disponibilizados novos boletos" : "Foi disponibilizado um novo boleto"} no seu Portal do Cliente:</p>
<table style="border-collapse:collapse;width:100%;font-size:14px;">
<tr style="background:#f1f3f8;text-align:left;"><th style="padding:8px 12px;">Boleto</th><th style="padding:8px 12px;">Valor</th><th style="padding:8px 12px;">Vencimento</th></tr>
${linhasHtml}</table>
<p style="margin:20px 0;"><a href="${PORTAL_URL}" style="background:#17244a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Acessar meus boletos</a></p>
<p style="font-size:12px;color:#5b6072;">Este é um aviso automático, não é necessário responder. Em caso de dúvidas, fale com a Trilhar Contabilidade.</p>
</div>`;
      const texto = `Olá, ${usuario.nome}!\n\n${plural ? "Foram disponibilizados novos boletos" : "Foi disponibilizado um novo boleto"} no seu Portal do Cliente:\n\n${linhasTxt}\n\nAcesse: ${PORTAL_URL}\n\nAviso automático da Trilhar Contabilidade.`;

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: remetente, to: [usuario.email], subject: assunto, html, text: texto }),
      });
      if (!resp.ok) {
        console.error("Resend recusou o envio:", resp.status, (await resp.text()).slice(0, 300));
        return jsonResponse({ error: "O provedor de e-mail recusou o envio" }, 502);
      }

      await adminClient.from("documentos").update({ notificado_em: new Date().toISOString() }).in("id", lista.map((d) => d.id));
      enviado = true;
    }

    return jsonResponse({ success: true, enviado }, 200);
  } catch (err) {
    console.error("Erro inesperado em notificar-boleto:", err);
    return jsonResponse({ error: "Erro inesperado ao enviar aviso" }, 500);
  }
});
