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
  // "Ver como cliente": um administrador abre o portal de um cliente
  // específico só para visualizar (botão no detalhe do cliente no admin).
  // Quem garante que só administrador lê os dados de outro cliente é o
  // banco (RLS); aqui só não redireciona o admin e bloqueia gravações.
  if (usuario.tipo === "administrador") {
    const verComoId = idVerComoSolicitado();
    if (verComoId) return carregarClienteParaVisualizacao(verComoId);
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
    nome: limparNomeAdmin(usuario.nome),
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


/* ---------- Ver como cliente (somente leitura) ----------
   O admin abre dashboard?ver_como=<id do cliente>. O id fica guardado na
   sessão desta aba para os links do menu do cliente continuarem no mesmo
   modo. Tudo que grava (inserir, alterar, excluir, enviar arquivo, RPCs
   como registrar acesso ou avisar pagamento) é bloqueado no próprio
   cliente Supabase desta página, e os botões de ação ficam escondidos.
   Nada é feito em nome do cliente. */
const CHAVE_VER_COMO = "trilhar-ver-como";
function idVerComoSolicitado() {
  const daUrl = new URLSearchParams(location.search).get("ver_como");
  if (daUrl) { try { sessionStorage.setItem(CHAVE_VER_COMO, daUrl); } catch (_) {} return daUrl; }
  try { return sessionStorage.getItem(CHAVE_VER_COMO); } catch (_) { return null; }
}
function sairVerComoCliente() {
  try { sessionStorage.removeItem(CHAVE_VER_COMO); } catch (_) {}
  window.location.href = "admin";
}
async function carregarClienteParaVisualizacao(clienteId) {
  const { data: cliente, error } = await sb
    .from("clientes")
    .select("id, tipo_pessoa, nome, sobrenome, razao_social, nome_fantasia, cpf, cnpj, telefone, created_at, users(id, nome, email)")
    .eq("id", clienteId)
    .maybeSingle();
  if (error) return mostrarFalhaDeConexao();
  if (!cliente) { sairVerComoCliente(); return null; }
  const nome = (cliente.users && cliente.users.nome) || cliente.razao_social || cliente.nome || "Cliente";
  ativarModoVisualizacao(nome);
  return {
    id: cliente.id,
    userId: cliente.users && cliente.users.id,
    nome,
    email: cliente.users && cliente.users.email,
    tipoPessoa: cliente.tipo_pessoa,
    nomeProprio: cliente.nome,
    sobrenome: cliente.sobrenome,
    razaoSocial: cliente.razao_social,
    nomeFantasia: cliente.nome_fantasia,
    cpf: cliente.cpf,
    cnpj: cliente.cnpj,
    telefone: cliente.telefone,
    created_at: cliente.created_at,
    modoVisualizacao: true
  };
}
function ativarModoVisualizacao(nome) {
  if (window.MODO_VER_COMO) return;
  window.MODO_VER_COMO = { nome };
  const aviso = () => { if (typeof showToast === "function") showToast("Modo visualização: nenhuma alteração é feita no portal do cliente."); };
  const erroBloqueio = { message: "Modo visualização (somente leitura)" };
  // Encadeável (.eq().select()...) e "aguardável", sempre devolvendo erro.
  const bloqueado = () => {
    aviso();
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") return (res, rej) => Promise.resolve({ data: null, error: erroBloqueio }).then(res, rej);
        return () => p;
      }
    });
    return p;
  };
  // Envolve cada consulta numa camada que troca os métodos de gravação pelo
  // bloqueio (em vez de reescrever o objeto da biblioteca, que nem sempre
  // aceita propriedades novas). Leitura (select, eq, order...) passa direto.
  const METODOS_DE_GRAVACAO = ["insert", "update", "upsert", "delete"];
  const fromOriginal = sb.from.bind(sb);

  // Mesmas limitações de leitura que o banco aplica a um cliente de verdade
  // (RLS "documentos_cliente_ve_os_seus" e "categorias_leitura_cliente"):
  // como o administrador enxerga tudo, aqui o próprio portal aplica o
  // mesmo filtro, para mostrar exatamente o que o cliente vê.
  //  - categorias: só as ativas;
  //  - documentos: só visivel_cliente = true e de categoria ativa.
  let idsCategoriasAtivas = null;
  const categoriasAtivas = () => idsCategoriasAtivas || (idsCategoriasAtivas =
    fromOriginal("categorias").select("id").eq("ativa", true).then(({ data }) => new Set((data || []).map((c) => c.id))));
  // Repassa a cadeia (.eq().order()...) mantendo a camada de filtro, e
  // filtra as linhas na hora de entregar o resultado.
  const filtrarResultado = (builder, filtro) => {
    const proxy = new Proxy(builder, {
      get(alvo, prop) {
        if (prop === "then") {
          return (res, rej) => alvo.then(async (r) => {
            if (r && !r.error && r.data) r.data = await filtro(r.data);
            return r;
          }).then(res, rej);
        }
        const v = Reflect.get(alvo, prop);
        if (typeof v !== "function") return v;
        return (...args) => { const out = v.apply(alvo, args); return out === alvo ? proxy : (out && typeof out.then === "function" ? filtrarResultado(out, filtro) : out); };
      }
    });
    return proxy;
  };
  const filtroDocumentos = async (data) => {
    const ativas = await categoriasAtivas();
    const ok = (d) => d.visivel_cliente !== false && (!d.categoria_id || ativas.has(d.categoria_id));
    return Array.isArray(data) ? data.filter(ok) : (ok(data) ? data : null);
  };

  sb.from = (tabela) => {
    const q = fromOriginal(tabela);
    return new Proxy(q, {
      get(alvo, prop) {
        if (METODOS_DE_GRAVACAO.includes(prop)) return bloqueado;
        if (prop === "select" && tabela === "categorias") {
          return (...args) => alvo.select(...args).eq("ativa", true);
        }
        if (prop === "select" && tabela === "documentos") {
          return (colunas, opcoes) => {
            const cols = (colunas || "*") + (colunas && colunas !== "*" ? ", visivel_cliente, categoria_id" : "");
            return filtrarResultado(alvo.select(cols, opcoes).eq("visivel_cliente", true), filtroDocumentos);
          };
        }
        const v = Reflect.get(alvo, prop);
        return typeof v === "function" ? v.bind(alvo) : v;
      }
    });
  };
  sb.rpc = async () => ({ data: null, error: erroBloqueio });
  const storageFromOriginal = sb.storage.from.bind(sb.storage);
  const negarArquivo = async () => { aviso(); return { data: null, error: erroBloqueio }; };
  sb.storage.from = (bucket) => {
    const b = storageFromOriginal(bucket);
    return new Proxy(b, {
      get(alvo, prop) {
        if (["upload", "update", "remove", "move", "copy"].includes(prop)) return negarArquivo;
        const v = Reflect.get(alvo, prop);
        return typeof v === "function" ? v.bind(alvo) : v;
      }
    });
  };
  const montarFaixa = () => {
    document.body.classList.add("modo-ver-como");
    if (document.getElementById("ver-como-faixa")) return;
    const faixa = document.createElement("div");
    faixa.id = "ver-como-faixa";
    faixa.className = "ver-como-faixa";
    faixa.setAttribute("role", "status");
    const texto = document.createElement("span");
    texto.innerHTML = "Vendo como <strong></strong> · somente leitura";
    texto.querySelector("strong").textContent = nome;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Voltar ao painel";
    btn.addEventListener("click", sairVerComoCliente);
    faixa.append(texto, btn);
    document.body.appendChild(faixa);
  };
  if (document.body) montarFaixa(); else window.addEventListener("DOMContentLoaded", montarFaixa);
}

// Alguns cadastros de administrador vieram com " (Cliente)" grudado no nome
// (ex.: "Trilhar Contabilidade (Cliente)"). No painel o nome aparece sem isso.
function limparNomeAdmin(nome) {
  return String(nome || "").replace(/\s*\(\s*cliente\s*\)\s*$/i, "").trim() || nome;
}
