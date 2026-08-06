// Convida um novo administrador (Auth + users + administradores). Mesmo
// motivo do admin-criar-cliente: criar conta de Auth exige a service_role
// key, que nunca pode ir pro navegador. Sem niveis/RBAC de proposito (por
// decisao do projeto) -- todo convidado entra como "administrador"; so o
// dono original da conta fica "proprietario", atribuido fora deste fluxo.
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
// contra abuso de uma sessão de admin comprometida (ou script em loop)
// convidando contas em sequência sem nenhum freio. Não é perfeitamente
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
    const { data: souAdmin, error: adminCheckError } = await callerClient.rpc("is_admin");
    if (adminCheckError || !souAdmin) {
      return jsonResponse({ error: "Apenas administradores podem convidar outros administradores" }, 403);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    const podeSeguir = await verificarRateLimit(adminClient, `admin-convidar-administrador:${ip}`, 10, 60);
    if (!podeSeguir) {
      return jsonResponse({ error: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente." }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const redirectTo = String(body.redirectTo || "").trim();

    if (!nome) return jsonResponse({ error: "Nome é obrigatório" }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "E-mail inválido" }, 400);

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { nome },
      redirectTo: redirectTo || undefined,
    });

    if (inviteError || !invited?.user) {
      const msg = inviteError?.message?.toLowerCase().includes("already been registered")
        ? "Já existe uma conta com esse e-mail"
        : (inviteError?.message || "Não foi possível convidar o administrador");
      return jsonResponse({ error: msg }, 400);
    }
    const authUserId = invited.user.id;

    const { data: userRow, error: userError } = await adminClient
      .from("users")
      .insert({ auth_user_id: authUserId, nome, email, tipo: "administrador", primeiro_acesso: true })
      .select("id")
      .single();

    if (userError || !userRow) {
      await adminClient.auth.admin.deleteUser(authUserId);
      return jsonResponse({ error: "Não foi possível criar o cadastro do administrador" }, 500);
    }

    const { data: adminRow, error: adminError } = await adminClient
      .from("administradores")
      .insert({ user_id: userRow.id, nivel: "administrador" })
      .select("id")
      .single();

    if (adminError || !adminRow) {
      await adminClient.from("users").delete().eq("id", userRow.id);
      await adminClient.auth.admin.deleteUser(authUserId);
      return jsonResponse({ error: "Não foi possível criar o cadastro do administrador" }, 500);
    }

    return jsonResponse({ success: true, administradorId: adminRow.id }, 200);
  } catch (_err) {
    return jsonResponse({ error: "Erro inesperado ao convidar administrador" }, 500);
  }
});
