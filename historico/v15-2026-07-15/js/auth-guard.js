/* Protege as páginas do cliente (painel/categoria/perfil): confirma sessão
   real do Supabase Auth E que existe uma linha em `clientes` vinculada a
   ela (nem toda conta autenticada é necessariamente um cliente ativo).

   Importante: RLS na tabela `clientes` só checa auth_user_id, não `ativo` —
   desativar um cliente não derruba a sessão dele no Supabase Auth. Quem
   aplica a regra "cliente inativo não entra" é este guard, a cada
   carregamento de página, não o banco. Uma aba já aberta continua
   mostrando dado até a próxima navegação/reload. */

function hideAuthOverlay() {
  const overlay = document.getElementById("auth-guard-overlay");
  if (overlay) overlay.remove();
}

async function guardCliente() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.replace("index.html");
    return null;
  }

  const { data: cliente, error } = await sb
    .from("clientes")
    .select("id, nome, email, documento, telefone, ativo, created_at")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();

  if (error || !cliente || !cliente.ativo) {
    await sb.auth.signOut();
    window.location.replace("index.html");
    return null;
  }

  return cliente;
}

async function logoutCliente(redirectTo) {
  await sb.auth.signOut();
  window.location.href = redirectTo || "index.html";
}
