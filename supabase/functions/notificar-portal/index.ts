// E-mails do portal disparados pelo painel admin:
//  - tipo "comunicado": manda um comunicado pra TODOS os clientes ativos de uma vez.
//  - tipo "chamado": avisa UM cliente que o chamado dele foi respondido (status,
//    prazo em dias/data e resposta).
// O navegador manda só o id; tudo é relido do banco aqui. Confere que quem chamou
// é admin (is_admin() com o JWT de quem chamou) antes de usar a service_role.
// Envio via API do Resend; precisa do secret RESEND_API_KEY (opcional RESEND_FROM).
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
const JANELA_CHAMADO_MS = 15 * 60 * 1000;
const PORTAL = "https://trilharcontabilidadese.com.br";
const STATUS_TXT: Record<string, string> = { aberto: "Aberto", em_andamento: "Em andamento", resolvido: "Resolvido" };

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function comQuebras(v: unknown): string {
  return esc(v).replace(/\r?\n/g, "<br>");
}
function dataBR(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
function um<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}
function moldura(titulo: string, corpoHtml: string, botao: string, href: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#161a2b;max-width:560px;margin:0 auto;">
<h2 style="color:#17244a;margin:0 0 12px;">Trilhar Contabilidade</h2>
<h3 style="margin:0 0 12px;">${esc(titulo)}</h3>
${corpoHtml}
<p style="margin:20px 0;"><a href="${href}" style="background:#17244a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">${esc(botao)}</a></p>
<p style="font-size:12px;color:#5b6072;">Este é um aviso automático, não é necessário responder.</p>
</div>`;
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
    if (!(await verificarRateLimit(adminClient, `notificar-portal:${ip}`, 20, 60))) {
      return jsonResponse({ error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const tipo = String(body.tipo || "");
    const id = String(body.id || "");
    if (!["comunicado", "chamado"].includes(tipo) || !UUID_RE.test(id)) {
      return jsonResponse({ error: "Pedido inválido" }, 400);
    }
    if (!resendKey) {
      console.error("RESEND_API_KEY não configurado nos secrets da Edge Function");
      return jsonResponse({ error: "Envio de e-mail ainda não configurado no servidor" }, 500);
    }

    async function enviarLote(mensagens: Record<string, unknown>[]): Promise<boolean> {
      for (let i = 0; i < mensagens.length; i += 100) {
        const resp = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(mensagens.slice(i, i + 100)),
        });
        if (!resp.ok) {
          console.error("Resend recusou o lote:", resp.status, (await resp.text()).slice(0, 300));
          return false;
        }
      }
      return true;
    }

    if (tipo === "comunicado") {
      const { data: com, error: comErr } = await adminClient
        .from("comunicados").select("id, titulo, mensagem, email_enviado_em").eq("id", id).maybeSingle();
      if (comErr || !com) return jsonResponse({ error: "Comunicado não encontrado" }, 404);
      if (com.email_enviado_em) return jsonResponse({ error: "Esse comunicado já foi enviado por e-mail" }, 409);

      const { data: clientes, error: cliErr } = await adminClient
        .from("clientes").select("users(nome, email, status)");
      if (cliErr) {
        console.error("Falha ao ler clientes:", cliErr.message);
        return jsonResponse({ error: "Não foi possível ler os clientes" }, 500);
      }
      const destinatarios = (clientes ?? [])
        .map((c) => um(c.users as { nome?: string; email?: string; status?: string } | undefined))
        .filter((u): u is { nome?: string; email: string; status?: string } => !!u && !!u.email && u.status === "ativo");

      const mensagens = destinatarios.map((u) => ({
        from: remetente,
        to: [u.email],
        subject: `Comunicado: ${com.titulo}`,
        html: moldura(com.titulo, `<p>Olá, ${esc(u.nome)}!</p><p>${comQuebras(com.mensagem)}</p>`, "Ver no portal", `${PORTAL}/comunicados`),
        text: `Olá, ${u.nome}!\n\n${com.titulo}\n\n${com.mensagem}\n\nVeja no portal: ${PORTAL}/comunicados`,
      }));
      if (mensagens.length === 0) return jsonResponse({ success: true, enviados: 0 }, 200);
      if (!(await enviarLote(mensagens))) return jsonResponse({ error: "O provedor de e-mail recusou o envio" }, 502);

      await adminClient.from("comunicados").update({ email_enviado_em: new Date().toISOString() }).eq("id", id);
      return jsonResponse({ success: true, enviados: mensagens.length }, 200);
    }

    // tipo === "chamado"
    const { data: ch, error: chErr } = await adminClient
      .from("chamados")
      .select("id, assunto, status, prazo_dias, prazo_data, resposta, respondido_em, clientes(users(nome, email, status))")
      .eq("id", id).maybeSingle();
    if (chErr || !ch) return jsonResponse({ error: "Chamado não encontrado" }, 404);
    if (!ch.respondido_em || Date.now() - new Date(ch.respondido_em).getTime() > JANELA_CHAMADO_MS) {
      return jsonResponse({ error: "Esse chamado não foi respondido há pouco" }, 409);
    }
    const cli = um(ch.clientes) as { users?: unknown } | undefined;
    const usuario = um(cli?.users as { nome?: string; email?: string; status?: string } | undefined);
    if (!usuario?.email || usuario.status !== "ativo") return jsonResponse({ success: true, enviados: 0 }, 200);

    const prazoHtml = ch.prazo_data && ch.status !== "resolvido"
      ? `<p><strong>Previsão:</strong> resolvido em ${ch.prazo_dias} ${ch.prazo_dias === 1 ? "dia" : "dias"} (até ${dataBR(ch.prazo_data)}).</p>` : "";
    const prazoTxt = ch.prazo_data && ch.status !== "resolvido"
      ? `Previsão: resolvido em ${ch.prazo_dias} ${ch.prazo_dias === 1 ? "dia" : "dias"} (até ${dataBR(ch.prazo_data)}).\n` : "";
    const respostaHtml = ch.resposta ? `<p><strong>Resposta da Trilhar:</strong><br>${comQuebras(ch.resposta)}</p>` : "";
    const respostaTxt = ch.resposta ? `Resposta da Trilhar:\n${ch.resposta}\n` : "";
    const statusTxt = STATUS_TXT[ch.status] ?? ch.status;

    const ok = await enviarLote([{
      from: remetente,
      to: [usuario.email],
      subject: `Seu chamado foi atualizado: ${ch.assunto}`,
      html: moldura(`Chamado: ${ch.assunto}`,
        `<p>Olá, ${esc(usuario.nome)}!</p><p><strong>Status:</strong> ${esc(statusTxt)}</p>${prazoHtml}${respostaHtml}`,
        "Ver meus chamados", `${PORTAL}/chamados`),
      text: `Olá, ${usuario.nome}!\n\nChamado: ${ch.assunto}\nStatus: ${statusTxt}\n${prazoTxt}${respostaTxt}\nVeja no portal: ${PORTAL}/chamados`,
    }]);
    if (!ok) return jsonResponse({ error: "O provedor de e-mail recusou o envio" }, 502);
    return jsonResponse({ success: true, enviados: 1 }, 200);
  } catch (err) {
    console.error("Erro inesperado em notificar-portal:", err);
    return jsonResponse({ error: "Erro inesperado ao enviar aviso" }, 500);
  }
});
