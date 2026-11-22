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

/* Nome da página atual sem extensão — o GitHub Pages serve tanto
   /pagina quanto /pagina.html pro mesmo arquivo, então os guards não podem
   depender de qual das duas formas está na barra de endereço. */
function paginaAtual() {
  return location.pathname.replace(/\.html$/, "").split("/").pop();
}

/* index.html (tela única de login) lembra o último tipo selecionado
   (Cliente/Administrador) num toggle no topo do cartão. Quando um guard
   manda alguém direto pra "/" (sessão de cliente expirada, sem permissão
   etc.), vale a pena já deixar "Cliente" marcado — senão a tela podia
   abrir com "Administrador" selecionado por um acesso anterior no mesmo
   navegador, o que contradiz a própria mensagem de erro que aparece
   junto. O lado admin não precisa disso: todo redirecionamento de admin
   já passa por admin-login.html, que marca "Administrador" sozinho. */
function lembrarTipoAcessoCliente() {
  try { localStorage.setItem("portal_tipo_acesso", "cliente"); } catch (_) {}
}

async function obterUsuarioAtual() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { session: null, usuario: null };
  const { data: usuario, error } = await sb
    .from("users")
    .select("id, nome, email, tipo, status, primeiro_acesso, avatar_url")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();
  return { session, usuario, error };
}

/* Falha de rede/servidor NÃO é falta de permissão: não desloga a pessoa,
   só avisa e deixa tentar de novo (senão um sinal ruim no celular fazia
   o cliente "perder o login" e achar que o app não funciona). */
function mostrarFalhaDeConexao() {
  const overlay = document.getElementById("auth-guard-overlay");
  const html = '<div style="max-width:320px;margin:0 auto;padding:24px;text-align:center;font-family:inherit;">' +
    '<p style="font-size:16px;margin:0 0 8px;font-weight:600;">Sem conexão com o portal</p>' +
    '<p style="font-size:14px;margin:0 0 16px;opacity:.8;">Não foi possível carregar seus dados agora. Sua sessão continua ativa, confira a internet e tente de novo.</p>' +
    '<button type="button" class="btn btn-primary" onclick="location.reload()">Tentar de novo</button></div>';
  if (overlay) { overlay.innerHTML = html; overlay.style.display = "flex"; overlay.style.alignItems = "center"; overlay.style.justifyContent = "center"; }
  else document.body.innerHTML = html;
  return null;
}

/* Protege as páginas do cliente. Mantém o MESMO formato de retorno de
   sempre ({id, nome, email, documento, telefone, created_at}, onde id =
   clientes.id) — é isso que permite dashboard/boletos/documentos/perfil
   continuarem funcionando sem nenhuma alteração depois da migração pra
   "users". */
async function guardCliente() {
  const { session, usuario, error: erroUsuario } = await obterUsuarioAtual();
  if (session && erroUsuario) return mostrarFalhaDeConexao();

  if (!session) {
    lembrarTipoAcessoCliente();
    window.location.replace("/");
    return null;
  }
  if (!usuario || usuario.status !== "ativo") {
    await sb.auth.signOut();
    lembrarTipoAcessoCliente();
    window.location.replace("/?erro=sem_permissao");
    return null;
  }
  if (usuario.tipo !== "cliente") {
    // Sessão válida, só não é dessa área — manda pro próprio espaço dele
    // em vez de deslogar (ele continua um usuário legítimo do sistema).
    window.location.replace("admin");
    return null;
  }
  if (usuario.primeiro_acesso && paginaAtual() !== "primeiro-acesso") {
    window.location.replace("primeiro-acesso");
    return null;
  }

  const { data: cliente, error } = await sb
    .from("clientes")
    .select("id, tipo_pessoa, nome, sobrenome, razao_social, nome_fantasia, cpf, cnpj, telefone, created_at")
    .eq("user_id", usuario.id)
    .maybeSingle();

  if (error) return mostrarFalhaDeConexao();
  if (!cliente) {
    await sb.auth.signOut();
    lembrarTipoAcessoCliente();
    window.location.replace("/?erro=sem_permissao");
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
  const { session, usuario, error: erroUsuario } = await obterUsuarioAtual();
  if (session && erroUsuario) return mostrarFalhaDeConexao();

  if (!session) {
    window.location.replace("admin-login");
    return null;
  }
  if (!usuario || usuario.status !== "ativo") {
    await sb.auth.signOut();
    window.location.replace("admin-login?erro=sem_permissao");
    return null;
  }
  if (usuario.tipo !== "administrador") {
    window.location.replace("dashboard");
    return null;
  }
  if (usuario.primeiro_acesso && paginaAtual() !== "primeiro-acesso") {
    window.location.replace("primeiro-acesso");
    return null;
  }

  const { data: administrador, error } = await sb
    .from("administradores")
    .select("id, nivel")
    .eq("user_id", usuario.id)
    .maybeSingle();

  if (error) return mostrarFalhaDeConexao();
  if (!administrador) {
    await sb.auth.signOut();
    window.location.replace("admin-login?erro=sem_permissao");
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
  const { session, usuario, error: erroUsuario } = await obterUsuarioAtual();
  if (session && erroUsuario) return mostrarFalhaDeConexao();

  if (!session) {
    lembrarTipoAcessoCliente();
    window.location.replace("/");
    return null;
  }
  if (!usuario || usuario.status !== "ativo") {
    await sb.auth.signOut();
    lembrarTipoAcessoCliente();
    window.location.replace("/?erro=sem_permissao");
    return null;
  }
  if (!usuario.primeiro_acesso) {
    window.location.replace(usuario.tipo === "administrador" ? "admin" : "dashboard");
    return null;
  }

  return usuario;
}

async function logoutCliente(redirectTo) {
  await sb.auth.signOut();
  if (!redirectTo) lembrarTipoAcessoCliente();
  window.location.href = redirectTo || "/";
}

async function logoutAdministrador(redirectTo) {
  await sb.auth.signOut();
  window.location.href = redirectTo || "admin-login";
}
