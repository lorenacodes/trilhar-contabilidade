// Exclusão PERMANENTE de um administrador (hard delete). Só o proprietário
// pode excluir outro administrador — mesma régua já usada para categorias
// (is_proprietario()). Duas travas de segurança adicionais: nunca deixar se
// autoexcluir (perderia acesso sem ter como reverter) e nunca excluir o
// último proprietário do sistema (essa segunda trava já existe também no
// banco via trigger, aqui é só uma mensagem de erro mais clara antes disso).
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

// Rate limiting: no máximo LIMITE chamadas por IP a cada JANELA_SEGUNDOS,
// contra abuso de uma sessão de proprietário comprometida (ou script em
// loop) excluindo contas em sequência sem nenhum freio. Não é perfeitamente
// atômico sob concorrência alta (select+update, não um upsert atômico
// único) — aceitável aqui porque o volume normal de uso administrativo é
// baixíssimo; o objetivo é frear abuso óbvio, não servir de rate limiter
// de produção de alto tráfego.
async function verificarRateLimit(
  adminClient: ReturnType<typeof createClient>,
  chave: string,
  limite: number,
  janelaSegundos: number,
): Promise<boolean> {
  const agora = new Date();
  await adminClient.from("rate_limit_contadores").delete().lt("expira_em", agora.toISOString());

  const { data: existente } = await adminClient
    .from("rate_limit_contadores")
    .select("contagem, expira_em")
    .eq("chave", chave)
    .maybeSingle();

  if (existente && new Date(existente.expira_em) > agora) {
    if (existente.contagem >= limite) return false;
    await adminClient.from("rate_limit_contadores").update({ contagem: existente.contagem + 1 }).eq("chave", chave);
    return true;
  }

  const expiraEm = new Date(agora.getTime() + janelaSegundos * 1000).toISOString();
  await adminClient.from("rate_limit_contadores").upsert({ chave, contagem: 1, expira_em: expiraEm });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: souProprietario, error: propCheckError } = await callerClient.rpc("is_proprietario");
    if (propCheckError || !souProprietario) {
      return jsonResponse({ error: "Apenas o proprietário pode excluir administradores" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const administradorId = String(body.administradorId || "").trim();
    if (!administradorId) return jsonResponse({ error: "administradorId é obrigatório" }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    const podeSeguir = await verificarRateLimit(adminClient, `admin-excluir-administrador:${ip}`, 10, 60);
    if (!podeSeguir) {
      return jsonResponse({ error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." }, 429);
    }

    const { data: { user: chamador } } = await callerClient.auth.getUser();
    if (chamador) {
      const { data: registroChamador } = await adminClient
        .from("users")
        .select("administradores(id)")
        .eq("auth_user_id", chamador.id)
        .maybeSingle();
      const meuAdminId = Array.isArray(registroChamador?.administradores)
        ? registroChamador?.administradores[0]?.id
        : registroChamador?.administradores?.id;
      if (meuAdminId === administradorId) {
        return jsonResponse({ error: "Não é possível excluir a própria conta de administrador" }, 400);
      }
    }

    const { data: administrador, error: administradorError } = await adminClient
      .from("administradores")
      .select("id, user_id, nivel, users(auth_user_id)")
      .eq("id", administradorId)
      .maybeSingle();

    if (administradorError || !administrador) {
      return jsonResponse({ error: "Administrador não encontrado" }, 404);
    }

    if (administrador.nivel === "proprietario") {
      const { count } = await adminClient
        .from("administradores")
        .select("id", { count: "exact", head: true })
        .eq("nivel", "proprietario");
      if ((count ?? 0) <= 1) {
        return jsonResponse({ error: "Não é possível excluir o único administrador proprietário do sistema" }, 400);
      }
    }

    const usuario = Array.isArray(administrador.users) ? administrador.users[0] : administrador.users;
    const authUserId: string | undefined = usuario?.auth_user_id;

    // Documentos que esse administrador criou/revisou continuam intactos —
    // o banco já troca criado_por/revisado_por pra NULL automaticamente
    // (ON DELETE SET NULL), então nada aqui precisa tratar isso manualmente.
    const { error: deleteAdminError } = await adminClient.from("administradores").delete().eq("id", administradorId);
    if (deleteAdminError) {
      const mensagem = deleteAdminError.message?.includes("único administrador proprietário")
        ? deleteAdminError.message
        : "Não foi possível excluir o administrador";
      return jsonResponse({ error: mensagem }, 500);
    }

    if (administrador.user_id) {
      await adminClient.from("users").delete().eq("id", administrador.user_id);
    }
    if (authUserId) {
      await adminClient.auth.admin.deleteUser(authUserId);
    }

    return jsonResponse({ success: true }, 200);
  } catch (_err) {
    return jsonResponse({ error: "Erro inesperado ao excluir administrador" }, 500);
  }
});
