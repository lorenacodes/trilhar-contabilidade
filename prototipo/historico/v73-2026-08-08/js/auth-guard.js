/* Autenticação e controle de acesso — fonte única de verdade é a tabela
   "users" (nome, e-mail, tipo, status, primeiro_acesso). Um usuário só entra
   se existir TANTO no Supabase Auth QUANTO em "users" — nunca só um dos dois.
   "clientes"/"administradores" são tabelas de detalhe (referenciam users.id),
   não de identidade — todo guard busca a sessão + a linha de users primeiro,
   e só depois o detalhe de perfil específico do papel. */

function hideAuthOverlay() {
  const overlay = document.getElementById("auth-guard-overlay");
  if (overlay) overlay.remove();
}

async function obterUsuarioAtual() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { session: null, usuario: null };
  const { data: usuario } = await sb
    .from("users")
    .select("id, nome, email, tipo, status, primeiro_acesso, avatar_url")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();
  return { session, usuario };
}

/* Protege as páginas do cliente. Mantém o MESMO formato de retorno de
   sempre ({id, nome, email, documento, telefone, created_at}, onde id =
   clientes.id) — é isso que permite dashboard/boletos/documentos/
   enviar-documento/perfil continuarem funcionando sem nenhuma alteração
   depois da migração pra "users". */
async function guardCliente() {
  const { session, usuario } = await obterUsuarioAtual();

  if (!session) {
    window.location.replace("index.html");
    return null;
  }
  if (!usuario || usuario.status !== "ativo") {
    await sb.auth.signOut();
    window.location.replace("index.html?erro=sem_permissao");
    return null;
  }
  if (usuario.tipo !== "cliente") {
    // Sessão válida, só não é dessa área — manda pro próprio espaço dele
    // em vez de deslogar (ele continua um usuário legítimo do sistema).
    window.location.replace("admin.html");
    return null;
  }
  if (usuario.primeiro_acesso && !location.pathname.endsWith("primeiro-acesso.html")) {
    window.location.replace("primeiro-acesso.html");
    return null;
  }

  const { data: cliente, error } = await sb
    .from("clientes")
    .select("id, tipo_pessoa, nome, sobrenome, razao_social, nome_fantasia, cpf, cnpj, telefone, created_at")
    .eq("user_id", usuario.id)
    .maybeSingle();

  if (error || !cliente) {
    await sb.auth.signOut();
    window.location.replace("index.html?erro=sem_permissao");
    return null;
  }

  return {
    id: cliente.id,
    userId: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    tipoPessoa: cliente.tipo_pessoa,
    nomeProprio: cliente.nome,
    sobrenome: cliente.sobrenome,
    razaoSocial: cliente.razao_social,
    nomeFantasia: cliente.nome_fantasia,
    cpf: cliente.cpf,
    cnpj: cliente.cnpj,
    telefone: cliente.telefone,
    created_at: cliente.created_at
  };
}

/* Protege admin.html. Espelha guardCliente(), com id = administradores.id. */
async function guardAdministrador() {
  const { session, usuario } = await obterUsuarioAtual();

  if (!session) {
    window.location.replace("admin-login.html");
    return null;
  }
  if (!usuario || usuario.status !== "ativo") {
    await sb.auth.signOut();
    window.location.replace("admin-login.html?erro=sem_permissao");
    return null;
  }
  if (usuario.tipo !== "administrador") {
    window.location.replace("dashboard.html");
    return null;
  }
  if (usuario.primeiro_acesso && !location.pathname.endsWith("primeiro-acesso.html")) {
    window.location.replace("primeiro-acesso.html");
    return null;
  }

  const { data: administrador, error } = await sb
    .from("administradores")
    .select("id, nivel")
    .eq("user_id", usuario.id)
    .maybeSingle();

  if (error || !administrador) {
    await sb.auth.signOut();
    window.location.replace("admin-login.html?erro=sem_permissao");
    return null;
  }

  return {
    id: administrador.id,
    userId: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    nivel: administrador.nivel,
    avatarUrl: usuario.avatar_url
  };
}

/* Só usado por primeiro-acesso.html — mesmas checagens de sessão/status,
   mas se a senha já foi trocada manda pro destino certo em vez de deixar
   entrar de novo (nada de "esqueci a URL da tela de troca de senha e
   consigo acessar sempre que quiser"). */
async function guardPrimeiroAcesso() {
  const { session, usuario } = await obterUsuarioAtual();

  if (!session) {
    window.location.replace("index.html");
    return null;
  }
  if (!usuario || usuario.status !== "ativo") {
    await sb.auth.signOut();
    window.location.replace("index.html?erro=sem_permissao");
    return null;
  }
  if (!usuario.primeiro_acesso) {
    window.location.replace(usuario.tipo === "administrador" ? "admin.html" : "dashboard.html");
    return null;
  }

  return usuario;
}

async function logoutCliente(redirectTo) {
  await sb.auth.signOut();
  window.location.href = redirectTo || "index.html";
}

async function logoutAdministrador(redirectTo) {
  await sb.auth.signOut();
  window.location.href = redirectTo || "admin-login.html";
}
