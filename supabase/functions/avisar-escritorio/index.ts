// Avisa por e-mail os administradores do escritório quando um CLIENTE:
//  - tipo "chamado": abre um chamado;
//  - tipo "alteracao": pede alteração de dados cadastrais;
//  - tipo "pagamento": avisa que pagou um boleto (precisa de "id" do documento).
// Quem chama é o cliente logado. O navegador não manda texto nenhum: a função relê o
// registro com o JWT do próprio cliente (RLS garante que é dele) e só envia se ele foi
// criado há pouco (janela de 15 min), então não dá pra usar isso pra disparar e-mail
// à toa. Limite de 6 avisos por hora por cliente.
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
const JANELA_MS = 15 * 60 * 1000;
const PAINEL = "https://trilharcontabilidadese.com.br/admin";

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function comQuebras(v: unknown): string {
  return esc(v).replace(/\r?\n/g, "<br>");
}
function um<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}
function recente(iso: unknown): boolean {
  const t = new Date(String(iso ?? "")).getTime();
  return Number.isFinite(t) && Date.now() - t >= 0 && Date.now() - t <= JANELA_MS;
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
    const { data: clienteId, error: cliErr } = await callerClient.rpc("current_cliente_id");
    if (cliErr || !clienteId) return jsonResponse({ error: "Apenas clientes podem usar este aviso" }, 403);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    if (!(await verificarRateLimit(adminClient, `avisar-escritorio:${clienteId}`, 6, 3600))) {
      return jsonResponse({ error: "Muitos avisos em pouco tempo" }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const tipo = String(body.tipo || "");
    const id = String(body.id || "");
    if (!["chamado", "alteracao", "pagamento"].includes(tipo) || (tipo === "pagamento" && !UUID_RE.test(id))) {
      return jsonResponse({ error: "Pedido inválido" }, 400);
    }
    if (!resendKey) {
      console.error("RESEND_API_KEY não configurado nos secrets da Edge Function");
      return jsonResponse({ error: "Envio de e-mail ainda não configurado no servidor" }, 500);
    }

    // Relê o registro como o próprio cliente (RLS) e monta o assunto/corpo.
    let assunto = "";
    let titulo = "";
    let corpoHtml = "";
    let corpoTxt = "";
    let aba = "";

    const { data: eu } = await adminClient
      .from("clientes").select("users(nome)").eq("id", clienteId).maybeSingle();
    const nomeCliente = String(um(um(eu?.users as { nome?: string }[] | { nome?: string } | undefined))?.nome ?? "Um cliente");

    if (tipo === "chamado") {
      const { data } = await callerClient.from("chamados")
        .select("assunto, descricao, created_at").eq("cliente_id", clienteId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data || !recente(data.created_at)) return jsonResponse({ error: "Nenhum chamado recente" }, 409);
      assunto = `Novo chamado de ${nomeCliente}: ${data.assunto}`;
      titulo = `Novo chamado: ${data.assunto}`;
      corpoHtml = `<p><strong>${esc(nomeCliente)}</strong> abriu um chamado.</p><p>${comQuebras(data.descricao)}</p>`;
      corpoTxt = `${nomeCliente} abriu um chamado.\n\n${data.assunto}\n${data.descricao}`;
      aba = "Chamados";
    } else if (tipo === "alteracao") {
      const { data } = await callerClient.from("solicitacoes_alteracao")
        .select("mensagem, created_at").eq("cliente_id", clienteId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data || !recente(data.created_at)) return jsonResponse({ error: "Nenhum pedido recente" }, 409);
      assunto = `Pedido de alteração de dados: ${nomeCliente}`;
      titulo = "Pedido de alteração de dados";
      corpoHtml = `<p><strong>${esc(nomeCliente)}</strong> pediu uma alteração nos dados cadastrais.</p><p>${comQuebras(data.mensagem)}</p>`;
      corpoTxt = `${nomeCliente} pediu uma alteração nos dados cadastrais.\n\n${data.mensagem}`;
      aba = "Visão geral, Atenção do dia";
    } else {
      const { data } = await callerClient.from("documentos")
        .select("nome, valor, pagamento_informado_em").eq("id", id).eq("cliente_id", clienteId).maybeSingle();
      if (!data || !recente(data.pagamento_informado_em)) return jsonResponse({ error: "Nenhum aviso de pagamento recente" }, 409);
      const valor = data.valor != null ? ` (R$ ${Number(data.valor).toFixed(2).replace(".", ",")})` : "";
      assunto = `${nomeCliente} avisou que pagou um boleto`;
      titulo = "Pagamento avisado";
      corpoHtml = `<p><strong>${esc(nomeCliente)}</strong> avisou que pagou o boleto <strong>${esc(data.nome)}</strong>${esc(valor)} e anexou o comprovante. Confirme o recebimento no painel.</p>`;
      corpoTxt = `${nomeCliente} avisou que pagou o boleto ${data.nome}${valor} e anexou o comprovante. Confirme o recebimento no painel.`;
      aba = "Financeiro";
    }

    const { data: admins, error: admErr } = await adminClient
      .from("administradores").select("users(email, status)");
    if (admErr) {
      console.error("Falha ao ler administradores:", admErr.message);
      return jsonResponse({ error: "Não foi possível ler os administradores" }, 500);
    }
    const destinatarios = [...new Set((admins ?? [])
      .map((a) => um(a.users as { email?: string; status?: string }[] | { email?: string; status?: string } | undefined))
      .filter((u): u is { email: string; status?: string } => !!u && !!u.email && u.status === "ativo")
      .map((u) => u.email))];
    if (destinatarios.length === 0) return jsonResponse({ success: true, enviados: 0 }, 200);

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#161a2b;max-width:560px;margin:0 auto;">
<h2 style="color:#17244a;margin:0 0 12px;">Trilhar Contabilidade</h2>
<h3 style="margin:0 0 12px;">${esc(titulo)}</h3>
${corpoHtml}
<p style="margin:20px 0;"><a href="${PAINEL}" style="background:#17244a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Abrir o painel (${esc(aba)})</a></p>
<p style="font-size:12px;color:#5b6072;">Este é um aviso automático para a equipe, não é necessário responder.</p>
</div>`;

    const resp = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(destinatarios.map((to) => ({
        from: remetente, to: [to], subject: assunto, html,
        text: `${corpoTxt}\n\nAbra o painel: ${PAINEL}`,
      }))),
    });
    if (!resp.ok) {
      console.error("Resend recusou o aviso:", resp.status, (await resp.text()).slice(0, 300));
      return jsonResponse({ error: "O provedor de e-mail recusou o envio" }, 502);
    }
    return jsonResponse({ success: true, enviados: destinatarios.length }, 200);
  } catch (err) {
    console.error("Erro inesperado em avisar-escritorio:", err);
    return jsonResponse({ error: "Erro inesperado ao enviar aviso" }, 500);
  }
});
