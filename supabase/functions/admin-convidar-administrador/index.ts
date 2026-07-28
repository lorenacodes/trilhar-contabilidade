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

    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const redirectTo = String(body.redirectTo || "").trim();

    if (!nome) return jsonResponse({ error: "Nome é obrigatório" }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "E-mail inválido" }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

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
