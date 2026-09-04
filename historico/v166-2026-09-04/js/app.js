/* Nome de arquivo seguro pra virar chave de objeto no Storage. Bug real
   encontrado em produção: nomes com acento (ç, ã, á...) faziam o upload
   falhar com 400 no Supabase Storage — "Cartao CNPJ.pdf" (só espaço) subia
   normal, mas "Contrato_alteração_espaço.pdf" não. Mantém o nome original
   bonito só pra exibição (nome_original na tabela); isso aqui é só pro
   caminho/chave dentro do bucket. */
function sanitizarNomeArquivo(nome) {
  const semAcento = nome.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return semAcento.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/* Valida um arquivo contra as regras configuradas na categoria (só tipo
   aceito — tamanho máximo foi removido de propósito, ver categoria.
   tamanho_maximo_mb: null é "sem limite", tratado igual no gatilho do banco
   validar_arquivo_documento(), nunca mais um fallback pra 10MB escondido).
   Retorna null se o arquivo passa, ou uma mensagem de erro pronta pra
   mostrar num toast. */
function validarArquivoParaCategoria(file, categoria) {
  const tiposAceitos = (categoria && categoria.tipos_arquivo_aceitos) || [];
  const tamanhoMaximoMb = categoria && categoria.tamanho_maximo_mb;
  const extensao = (file.name.split(".").pop() || "").toUpperCase();

  if (tiposAceitos.length && !tiposAceitos.includes(extensao)) {
    return `Tipo de arquivo ".${extensao.toLowerCase()}" não é aceito nesta categoria — envie: ${tiposAceitos.join(", ")}.`;
  }
  if (tamanhoMaximoMb && file.size > tamanhoMaximoMb * 1024 * 1024) {
    return `Arquivo maior que o permitido nesta categoria (máx. ${tamanhoMaximoMb} MB).`;
  }
  return null;
}

/* Escapa qualquer valor antes de entrar em um template de innerHTML. Nome de
   arquivo, nome de cliente/categoria, motivo de rejeição etc. vêm sempre de
   dados que passaram pela mão de alguém fora do time (cliente escolhendo o
   nome do arquivo no próprio computador, por exemplo) — sem isso, um nome de
   arquivo como "<img src=x onerror=...>.pdf" executa dentro da sessão de
   quem estiver com a tela aberta (inclusive um administrador). */
function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* Destaque tipográfico pros centavos de um valor em R$ já formatado (ex.:
   "R$ 34.680,05") — o inteiro fica grande/em negrito, os centavos ficam
   pequenos/claros (span .stat-value-decimals), o mesmo truque visual que
   painel financeiro costuma usar pra o olho pegar o número "de verdade"
   primeiro. Só pra HTML de exibição (usar com innerHTML) — o "," é o
   separador decimal do formato pt-BR que o sistema já usa em toda parte. */
function realceDecimais(valorFormatado) {
  const texto = String(valorFormatado ?? "");
  const idx = texto.lastIndexOf(",");
  if (idx === -1) return escapeHtml(texto);
  return escapeHtml(texto.slice(0, idx)) + '<span class="stat-value-decimals">' + escapeHtml(texto.slice(idx)) + "</span>";
}

/* ---------- Armazenamento à prova de falhas ----------
   Em alguns contextos (aba anônima com bloqueio de storage, certas configurações
   de navegador, ou abrir o arquivo direto sem servidor) o acesso ao localStorage
   pode lançar erro. Sem essa proteção, UM erro aqui travava o app.js inteiro
   e quebrava a página toda (ícones, calendário, categorias — tudo de uma vez). */
const safeStorage = (function () {
  const memoryFallback = {};
  let storageOk = true;
  try {
    localStorage.setItem("__trilhar_test__", "1");
    localStorage.removeItem("__trilhar_test__");
  } catch (e) {
    storageOk = false;
  }
  return {
    getItem(key) {
      if (!storageOk) return memoryFallback[key] ?? null;
      try { return localStorage.getItem(key); } catch (e) { return memoryFallback[key] ?? null; }
    },
    setItem(key, value) {
      memoryFallback[key] = value;
      if (!storageOk) return;
      try { localStorage.setItem(key, value); } catch (e) { /* ignora — já está no fallback em memória */ }
    },
    removeItem(key) {
      delete memoryFallback[key];
      if (!storageOk) return;
      try { localStorage.removeItem(key); } catch (e) { /* ignora */ }
    }
  };
})();

(function () {
  const saved = safeStorage.getItem("trilhar-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);

  window.addEventListener("DOMContentLoaded", () => {
    const toggles = document.querySelectorAll("[data-theme-toggle]");
    if (!toggles.length) return;
    toggles.forEach((btn) => {
      updateLabel(btn);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const current = document.documentElement.getAttribute("data-theme");
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        safeStorage.setItem("trilhar-theme", next);
        toggles.forEach(updateLabel);
      });
    });
  });

  function updateLabel(btn) {
    const current = document.documentElement.getAttribute("data-theme");
    btn.innerHTML = current === "dark"
      ? ICONS.sun + " Tema claro"
      : ICONS.moon + " Tema escuro";
  }

  document.addEventListener("click", (e) => {
    document.querySelectorAll(".dropdown-panel.open").forEach((panel) => {
      if (!panel.parentElement.contains(e.target)) panel.classList.remove("open");
    });
  });
})();

const ICONS = {
  sun: '<svg class="icon" style="width:14px;height:14px;display:inline;vertical-align:-2px" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="icon" style="width:14px;height:14px;display:inline;vertical-align:-2px" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 109.8 9.8z"/></svg>',
  bell: '<svg class="icon" viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 4-2 5-2 7h16c0-2-2-3-2-7"/><path d="M9 19a3 3 0 006 0"/></svg>',
  user: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  logout: '<svg class="icon" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  doc: '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
  chevron: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  card: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  building: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/></svg>',
  contract: '<svg class="icon" viewBox="0 0 24 24"><path d="M16 2H8a2 2 0 00-2 2v16a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  chart: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 5-7"/></svg>',
  download: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>',
  upload: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/></svg>',
  spinner: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-9-9"/></svg>',
  empty: '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h3"/></svg>',
  mail: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 6l10 7 10-7"/></svg>',
  camera: '<svg class="icon" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h3l2-3h8l2 3h3a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
  dot: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  eye: '<svg class="icon" viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg class="icon" viewBox="0 0 24 24"><path d="M17.9 17.9A10.9 10.9 0 0112 19c-7 0-11-7-11-7a19.7 19.7 0 015.1-5.9M9.9 4.2A9.6 9.6 0 0112 4c7 0 11 7 11 7a19.7 19.7 0 01-2.6 3.6M14.1 14.1a3 3 0 11-4.2-4.2"/><path d="M1 1l22 22"/></svg>',
  phone: '<svg class="icon" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.9a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.4 1.9.6 2.9.7a2 2 0 011.7 2z"/></svg>',
  kebab: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  edit: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  lock: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>'
};

/* Realtime pro painel do cliente — mesmo padrão já usado no admin
   (admin.html:iniciarRealtimeSync): em vez de tentar aplicar um patch
   parcial na linha que mudou, qualquer evento nas tabelas informadas
   dispara um refetch completo (debounced 600ms, pra uma sequência rápida
   de eventos virar um único refetch), reaproveitando a função de
   carregamento que a própria página já usa no load inicial — mesma
   garantia de consistência de sempre, sem duplicar lógica de leitura.
   "filter" é só otimização de rede (evita a página receber evento de
   documento de outro cliente pela rede); a segurança de verdade é a RLS
   de cada tabela, que decide sozinha o que esta conexão recebe. Cada
   página do cliente vive numa aba só (sem SPA/navegação sem reload),
   então um canal por carregamento de página nunca duplica — mas
   removemos no beforeunload mesmo assim, pra não deixar a conexão
   aberta em segundo plano se o navegador mantiver a página em cache. */
function iniciarRealtimeCliente(clienteId, tabelas, onMudanca) {
  let debounceTimer = null;
  const agendar = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onMudanca, 600);
  };
  let canal = sb.channel("cliente-realtime-" + clienteId);
  tabelas.forEach(({ table, filter }) => {
    canal = canal.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, agendar);
  });
  canal.subscribe();
  window.addEventListener("beforeunload", () => sb.removeChannel(canal));
  return canal;
}

/* Mostrar/ocultar senha — qualquer botão com data-password-toggle="id-do-
   input" ganha esse comportamento automaticamente (login do admin, login
   do cliente, primeiro acesso, redefinir senha, trocar senha em Perfil).
   Só alterna o atributo "type" do input (senha->texto e volta) — nunca lê
   nem grava o valor, nunca loga nada, nunca manda o valor pra lugar
   nenhum além do fluxo normal de autenticação que já existia. Acessível
   via teclado de graça por ser um <button> de verdade (Tab + Enter/Espaço
   funcionam sem nenhum JS extra), e o aria-label/aria-pressed acompanham
   o estado atual pra leitor de tela. */
window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-password-toggle]").forEach((btn) => {
    const input = document.getElementById(btn.dataset.passwordToggle);
    if (!input) return;
    const atualizar = () => {
      const visivel = input.type === "text";
      btn.innerHTML = visivel ? ICONS.eyeOff : ICONS.eye;
      btn.setAttribute("aria-label", visivel ? "Ocultar senha" : "Mostrar senha");
      btn.setAttribute("aria-pressed", visivel ? "true" : "false");
    };
    atualizar();
    btn.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      atualizar();
    });
  });
});

/* Navegação compartilhada das páginas novas do cliente (Dashboard, Boletos,
   Documentos, Enviar Documento, Perfil) — sidebar no desktop/tablet, barra
   inferior no mobile (troca via CSS, o mesmo HTML serve pros dois). Um único
   ponto de manutenção evita que 5 páginas fiquem com a nav dessincronizada. */
const NAV_ITEMS = [
  { slug: "dashboard", label: "Dashboard", icon: "chart", href: "dashboard" },
  { slug: "boletos", label: "Boletos", icon: "card", href: "boletos" },
  { slug: "documentos", label: "Documentos", icon: "doc", href: "documentos" },
  { slug: "enviar", label: "Enviar Documento", icon: "download", href: "enviar-documento" },
  { slug: "perfil", label: "Perfil", icon: "user", href: "perfil" }
];

/* Sidebar do painel do cliente — mesma linguagem visual e mesmo
   comportamento (recolher, arrastar largura, drawer no mobile) da sidebar
   do admin (ver admin.html), pra sentir o mesmo produto. É uma cópia
   deliberada da lógica de admin.html, não uma função compartilhada: o
   admin já funciona testado do jeito que está, e mexer nele só pra
   compartilhar código com o cliente é risco desnecessário (regra: não
   quebrar o administrativo). Reaproveita 100% das classes .admin-* já
   existentes no CSS — nenhuma regra nova. */
function renderNav(paginaAtiva, cliente) {
  const shell = document.getElementById("admin-shell");
  if (!shell) return;

  const aside = document.createElement("aside");
  aside.className = "admin-sidebar";
  aside.id = "admin-sidebar";
  aside.innerHTML = `
    <div class="admin-sidebar-resize-handle" id="admin-sidebar-resize-handle" title="Arrastar para ajustar a largura"></div>
    <div class="admin-sidebar-header">
      <div class="brand">
        <div class="brand-mark"><img src="img/logo-glyph.png" alt="Trilhar Contabilidade"></div>
        <div class="admin-sidebar-brand-text">
          <div class="brand-name">Trilhar Contabilidade</div>
          <div class="brand-sub">PAINEL DO CLIENTE</div>
        </div>
      </div>
      <button class="admin-nav-toggle" id="admin-nav-toggle" title="Recolher menu"></button>
    </div>
    <nav class="admin-nav" id="admin-nav">
      ${NAV_ITEMS.map(item => `
        <a class="admin-nav-item${item.slug === paginaAtiva ? " active" : ""}" href="${item.href}">
          <span class="admin-nav-item-icon">${ICONS[item.icon]}</span>
          <span class="admin-nav-item-label">${item.label}</span>
        </a>
      `).join("")}
    </nav>
    <div class="admin-sidebar-footer">
      <div class="dropdown-wrap">
        <div class="user-chip" style="cursor:pointer" id="sidebar-user-chip">
          <div class="avatar" id="sidebar-avatar"></div>
          <div class="admin-sidebar-user-text">
            <span id="sidebar-user-nome"></span>
            <small>Cliente</small>
          </div>
        </div>
        <div class="dropdown-panel" id="user-panel">
          <div class="dropdown-header">Conta</div>
          <div class="dropdown-item" id="sidebar-perfil-item">${ICONS.user} Meu perfil</div>
          <div class="dropdown-item" data-theme-toggle></div>
          <div class="dropdown-divider"></div>
          <div class="dropdown-item" id="sidebar-logout-item">${ICONS.logout} Sair</div>
        </div>
      </div>
    </div>
  `;
  shell.insertBefore(aside, shell.firstChild);

  if (cliente) {
    document.getElementById("sidebar-user-nome").textContent = cliente.nome;
    document.getElementById("sidebar-avatar").textContent = cliente.nome.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  }
  document.getElementById("sidebar-user-chip").addEventListener("click", () => toggleDropdown("user-panel"));
  document.getElementById("sidebar-perfil-item").addEventListener("click", () => window.location.href = "perfil");
  document.getElementById("sidebar-logout-item").addEventListener("click", () => logoutCliente());

  // O listener global de tema (DOMContentLoaded, no topo deste arquivo) já
  // passou quando este botão é criado dinamicamente — replica a mesma
  // lógica só pra ele.
  const themeBtn = aside.querySelector("[data-theme-toggle]");
  const updateThemeLabel = () => {
    const current = document.documentElement.getAttribute("data-theme");
    themeBtn.innerHTML = current === "dark" ? ICONS.sun + " Tema claro" : ICONS.moon + " Tema escuro";
  };
  updateThemeLabel();
  themeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    safeStorage.setItem("trilhar-theme", next);
    updateThemeLabel();
  });

  // ---------- Recolher (desktop) + drawer (mobile) + largura ajustável ----------
  // Chaves de localStorage próprias (não compartilhadas com o admin) — cada
  // papel guarda sua própria preferência de largura/recolhido.
  const SIDEBAR_COLLAPSE_KEY = "trilhar-client-sidebar-collapsed";
  const SIDEBAR_WIDTH_KEY = "trilhar-client-sidebar-width";
  const SIDEBAR_MIN_WIDTH = 200;
  const SIDEBAR_MAX_WIDTH = 400;
  const contentEl = document.querySelector(".admin-content");
  const backdropEl = document.getElementById("admin-sidebar-backdrop");

  function applyWidth(px) { aside.style.width = px + "px"; contentEl.style.marginLeft = px + "px"; }
  function clearWidth() { aside.style.width = ""; contentEl.style.marginLeft = ""; }

  const savedWidth = parseInt(safeStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
  const startsCollapsed = safeStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  if (startsCollapsed) shell.classList.add("sidebar-collapsed");
  else if (savedWidth) applyWidth(savedWidth);

  document.getElementById("admin-nav-toggle").innerHTML = ICONS.back;
  document.getElementById("admin-nav-toggle").addEventListener("click", () => {
    const collapsed = shell.classList.toggle("sidebar-collapsed");
    safeStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
    if (collapsed) clearWidth();
    else {
      const width = parseInt(safeStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
      if (width) applyWidth(width);
    }
  });

  const resizeHandle = document.getElementById("admin-sidebar-resize-handle");
  let resizing = false;
  let lastWidth = savedWidth || 260;
  resizeHandle.addEventListener("mousedown", (e) => {
    if (shell.classList.contains("sidebar-collapsed") || window.innerWidth <= 1024) return;
    resizing = true;
    aside.classList.add("resizing");
    contentEl.classList.add("resizing");
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    lastWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, e.clientX));
    applyWidth(lastWidth);
  });
  window.addEventListener("mouseup", () => {
    if (!resizing) return;
    resizing = false;
    aside.classList.remove("resizing");
    contentEl.classList.remove("resizing");
    document.body.style.userSelect = "";
    safeStorage.setItem(SIDEBAR_WIDTH_KEY, Math.round(lastWidth));
  });

  const mobileMenuBtn = document.getElementById("admin-mobile-menu-btn");
  if (mobileMenuBtn) {
    mobileMenuBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    mobileMenuBtn.addEventListener("click", () => {
      aside.classList.add("mobile-open");
      backdropEl.classList.add("open");
    });
  }
  if (backdropEl) {
    backdropEl.addEventListener("click", () => {
      aside.classList.remove("mobile-open");
      backdropEl.classList.remove("open");
    });
  }
  aside.querySelectorAll(".admin-nav-item").forEach(item => item.addEventListener("click", () => {
    aside.classList.remove("mobile-open");
    if (backdropEl) backdropEl.classList.remove("open");
  }));
}

/* Política de senha (primeiro-acesso.html e redefinir-senha.html) — critérios
   reais, não só estética: 8+ caracteres (ideal 12+), maiúscula, minúscula,
   número, especial, e não estar entre as senhas mais óbvias/previsíveis
   (uma senha "complexa" tecnicamente mas óbvia, tipo "Senha123!", ainda é
   fraca na prática, então zera a pontuação em vez de só descontar). */
const SENHAS_COMUNS = [
  "12345678", "123456789", "1234567890", "password", "password1", "senha123",
  "qwertyui", "abcdefgh", "11111111", "00000000", "letmein1", "admin123",
  "trilhar123", "contabilidade", "mudar123", "temporaria", "senha1234"
];

function avaliarForcaSenha(senha) {
  const criterios = {
    tamanho: senha.length >= 8,
    tamanhoIdeal: senha.length >= 12,
    maiuscula: /[A-Z]/.test(senha),
    minuscula: /[a-z]/.test(senha),
    numero: /[0-9]/.test(senha),
    especial: /[^A-Za-z0-9]/.test(senha),
    naoComum: senha.length === 0 || !SENHAS_COMUNS.includes(senha.toLowerCase())
  };

  const valida = criterios.tamanho && criterios.maiuscula && criterios.minuscula
    && criterios.numero && criterios.especial && criterios.naoComum;

  let pontos = 0;
  if (criterios.tamanho) pontos++;
  if (criterios.tamanhoIdeal) pontos++;
  if (criterios.maiuscula) pontos++;
  if (criterios.minuscula) pontos++;
  if (criterios.numero) pontos++;
  if (criterios.especial) pontos++;
  if (!criterios.naoComum) pontos = 0; // senha comum é sempre fraca, não importa o resto

  let label, cls;
  if (senha.length === 0) { label = ""; cls = ""; }
  else if (pontos <= 2) { label = "Fraca"; cls = "danger"; }
  else if (pontos <= 4) { label = "Regular"; cls = "warning"; }
  else if (pontos <= 5) { label = "Boa"; cls = "warning"; }
  else { label = "Forte"; cls = "ok"; }

  return { criterios, pontos, label, cls, valida };
}

function toggleDropdown(id) {
  document.querySelectorAll(".dropdown-panel.open").forEach((p) => {
    if (p.id !== id) p.classList.remove("open");
  });
  const panel = document.getElementById(id);
  if (panel) panel.classList.toggle("open");
}

function showToast(message) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg><span></span>';
  toast.querySelector("span").textContent = message;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function simulateDownload(btn, fileName) {
  const original = btn.innerHTML;
  btn.classList.add("btn-loading");
  btn.innerHTML = ICONS.spinner + " Baixando...";
  btn.disabled = true;
  setTimeout(() => {
    btn.classList.remove("btn-loading");
    btn.innerHTML = original;
    btn.disabled = false;
    showToast("Download concluído: " + fileName);
  }, 900);
}

/* Regra de negócio: só boleto tem vencimento e status de pagamento (binário
   pago/nao_pago no banco). "Vencendo"/"Vencido" não existem como valores
   guardados — são calculados aqui a partir de data_vencimento vs hoje, só
   pra exibição. Documentos sem data_vencimento (tudo que não é boleto) não
   têm status algum: retorna null e a tela não mostra nenhuma tag. */
function statusBoleto(doc, diasAlerta) {
  if (!doc.data_vencimento) return null;
  if (doc.status === "pago") return { label: "Pago", cls: "ok" };

  // data_vencimento vem como "AAAA-MM-DD" (date do Postgres). new Date(string) a
  // interpreta como UTC meia-noite — em fuso negativo (Brasil) isso podia virar
  // o dia anterior na hora de comparar. Monta a data com componentes locais em
  // vez de deixar o parser de string decidir o fuso.
  const [ano, mes, dia] = doc.data_vencimento.split("-").map(Number);
  const vencimento = new Date(ano, mes - 1, dia);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const limite = diasAlerta || 7;
  const dias = Math.round((vencimento - hoje) / 86400000);
  if (dias < 0) return { label: "Vencido", cls: "danger", dias };
  if (dias <= limite) return { label: "Vence em " + dias + (dias === 1 ? " dia" : " dias"), cls: "warning", dias };
  return { label: "Pendente", cls: "neutral", dias };
}

/* Validade de um documento aprovado (ex: Contrato) — não é sobre pagamento,
   é sobre o documento em si precisar ser renovado. Mesmo cuidado de fuso
   horário do statusBoleto acima (data "AAAA-MM-DD" via componentes locais,
   nunca new Date(string) direto). Retorna null quando não há data de
   validade definida (documento sem prazo de validade). */
function statusValidadeDocumento(dataValidade, diasAlerta) {
  if (!dataValidade) return null;
  const [ano, mes, dia] = dataValidade.split("-").map(Number);
  const validade = new Date(ano, mes - 1, dia);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const limite = diasAlerta || 7;
  const dias = Math.round((validade - hoje) / 86400000);
  if (dias < 0) return { label: "Vencido", cls: "danger", dias };
  if (dias <= limite) return { label: "Vence em " + dias + (dias === 1 ? " dia" : " dias"), cls: "warning", dias };
  return { label: "Válido", cls: "ok", dias };
}

/* Uma categoria só é "admin-only" (ex: boletos) via o campo real
   quem_pode_anexar — substitui o antigo isBoletoCategoria()/slug hardcoded
   que existia espalhado (com pequenas variações) em várias telas. */
function categoriaVisivelParaCliente(cat) {
  // Falha fechado: se por algum motivo "ativa" não veio na consulta (select
  // incompleto, por exemplo), a categoria fica escondida por padrão em vez
  // de visível — mais seguro errar escondendo do que errar mostrando algo
  // que devia estar desativado.
  // Categoria de boleto nunca aparece aqui, mesmo com quem_pode_anexar
  // permitindo cliente/ambos: o cliente pode responder a um boleto já
  // existente (avisar pagamento com comprovante), mas nunca criar um boleto
  // do zero pela tela de upload — isso é sempre o escritório quem lança.
  // A mesma regra já é reforçada no banco (RLS de documentos), isso aqui é
  // só pra nem oferecer a opção na tela.
  return !!cat && cat.ativa === true && cat.quem_pode_anexar !== "administrador" && !cat.eh_boleto;
}

/* "Período atual" de uma categoria recorrente — mesmos formatos gravados
   pelo trigger definir_periodo_referencia() no banco (America/Sao_Paulo).
   Isso é só pra saber QUAL período procurar na tela; quem decide de
   verdade o período de cada documento enviado é sempre o servidor. */
function periodoAtual(frequencia) {
  const agora = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  if (frequencia === "mensal") return agora.getFullYear() + "-" + pad(agora.getMonth() + 1);
  if (frequencia === "anual") return String(agora.getFullYear());
  if (frequencia === "quinzenal") {
    const quinzena = agora.getDate() <= 15 ? "1" : "2";
    return agora.getFullYear() + "-" + pad(agora.getMonth() + 1) + "-Q" + quinzena;
  }
  if (frequencia === "semanal") {
    // Semana ISO (segunda a domingo) + ano ISO — mesmo formato IYYY-IW do
    // Postgres, que evita o ano "virar" errado perto do fim de dezembro.
    const d = new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
    const diaIso = d.getUTCDay() || 7; // domingo (0) vira 7
    d.setUTCDate(d.getUTCDate() + 4 - diaIso);
    const anoIso = d.getUTCFullYear();
    const inicioAno = new Date(Date.UTC(anoIso, 0, 1));
    const semanaIso = Math.ceil((((d - inicioAno) / 86400000) + 1) / 7);
    return anoIso + "-" + pad(semanaIso);
  }
  return null; // sob_demanda não tem período
}

const STATUS_DOCUMENTO_LABELS = {
  pendente: { label: "Pendente", cls: "neutral" },
  enviado: { label: "Enviado", cls: "warning" },
  em_analise: { label: "Em análise", cls: "warning" },
  aprovado: { label: "Aprovado", cls: "ok" },
  rejeitado: { label: "Rejeitado", cls: "danger" }
};

function documentoMaisRecente(documentos) {
  if (!documentos.length) return null;
  return documentos.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

const NOMES_MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

/* Ano/mês/dia de um timestamp SEMPRE em America/Sao_Paulo, nunca no fuso do
   navegador de quem está olhando a tela — mesmo motivo de periodoAtual()
   acima: um documento enviado às 23h40 de Brasília não pode "pular" pro dia
   seguinte só porque um administrador está olhando de outro fuso horário.
   created_at já vem com fuso embutido (timestamptz), então isso é só uma
   conversão de exibição — não tem o mesmo risco de parsing de data pura
   (tipo data_vencimento) que o parseDataLocal() de cada tela já contorna. */
function chaveDataLocal(dataIso) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(dataIso));
  const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
  return { ano: mapa.year, mes: mapa.month, dia: mapa.day };
}

/* Agrupa qualquer lista de itens com data (documentos, arquivos etc) em
   Ano > Mês > Dia, sempre do mais recente pro mais antigo — mesma leitura
   "o que chegou primeiro" que um extrato bancário ou uma caixa de entrada de
   e-mail já usam, familiar pra qualquer usuário sem precisar explicar nada.
   `obterData` extrai a data (string ISO) de cada item — permite reusar isso
   tanto para documentos.created_at quanto qualquer outra lista futura. */
/* Ano/mês/dia de uma coluna DATE pura (ex: data_vencimento), direto do texto
   "AAAA-MM-DD" — sem passar por new Date()/timezone. new Date("2026-07-23")
   é interpretado como UTC meia-noite, e em fuso negativo (Brasil, UTC-3) isso
   vira 22/07 às 21h na conversão pra America/Sao_Paulo que o chaveDataLocal()
   faria — um boleto vencendo dia 23 apareceria agrupado no dia 22. DATE não
   tem fuso horário embutido (diferente de created_at, que é timestamptz),
   então o único jeito correto de ler é o texto literal, sem conversão nenhuma. */
function chaveDataPura(dataYmd) {
  const [ano, mes, dia] = dataYmd.split("-");
  return { ano, mes, dia };
}

function agruparPorData(itens, obterData, obterChave) {
  const chaveFn = obterChave || chaveDataLocal;
  const porAno = new Map();

  itens.forEach(item => {
    const iso = obterData(item);
    if (!iso) return; // item sem data não entra no agrupamento (não deveria acontecer, created_at é not null)
    const { ano, mes, dia } = chaveFn(iso);

    if (!porAno.has(ano)) porAno.set(ano, new Map());
    const porMes = porAno.get(ano);

    if (!porMes.has(mes)) porMes.set(mes, new Map());
    const porDia = porMes.get(mes);

    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(item);
  });

  const anos = Array.from(porAno.keys()).sort((a, b) => b.localeCompare(a));
  return anos.map(ano => {
    const porMes = porAno.get(ano);
    const meses = Array.from(porMes.keys()).sort((a, b) => b.localeCompare(a));
    let totalAno = 0;

    const mesesOut = meses.map(mes => {
      const porDia = porMes.get(mes);
      const dias = Array.from(porDia.keys()).sort((a, b) => b.localeCompare(a));
      let totalMes = 0;

      const diasOut = dias.map(dia => {
        const doDia = porDia.get(dia).slice().sort((a, b) => new Date(obterData(b)) - new Date(obterData(a)));
        totalMes += doDia.length;
        return { dia, chave: ano + "-" + mes + "-" + dia, itens: doDia };
      });

      totalAno += totalMes;
      return { mes, nomeMes: NOMES_MESES_PT[parseInt(mes, 10) - 1], chave: ano + "-" + mes, total: totalMes, dias: diasOut };
    });

    return { ano, total: totalAno, meses: mesesOut };
  });
}

/* "Pendente" nunca é uma linha gravada — só existe pela AUSÊNCIA de
   qualquer envio pra essa obrigação (categoria, e pro período atual quando
   a categoria é recorrente). Se já existe pelo menos um envio, mostra o
   status desse envio mais recente — mesmo rejeitado, nunca "esconde" uma
   rejeição voltando a mostrar pendente sem motivo. Usado igual pelo
   checklist do cliente, pelo painel de detalhe do admin e pelas contagens
   agregadas — pra não recalcular essa regra diferente em cada tela. */
function statusParaCategoria(categoria, documentosDaCategoria) {
  let candidatos = documentosDaCategoria;
  if (categoria.recorrente) {
    const periodo = periodoAtual(categoria.frequencia);
    candidatos = documentosDaCategoria.filter((d) => d.periodo_referencia === periodo);
  }
  const doc = documentoMaisRecente(candidatos);
  if (!doc) return { status: "pendente", documento: null, motivoRejeicao: null };
  return {
    status: doc.status_revisao,
    documento: doc,
    motivoRejeicao: doc.status_revisao === "rejeitado" ? doc.motivo_rejeicao : null
  };
}

/* Download real (Supabase Storage), usado nas páginas do cliente (categoria.html).
   admin.html continua com simulateDownload acima — não muda nesta fase. */
async function downloadFile(btn, storagePath, fileName) {
  // Abre a aba ANTES de qualquer await, com uma URL em branco — é isso que
  // faz o navegador reconhecer a abertura como resultado direto do clique.
  // Bug real encontrado: como a criação da URL assinada é assíncrona
  // (round-trip de rede), abrir a aba só DEPOIS do await faz o bloqueador de
  // pop-up de vários navegadores (Safari sempre, Chrome dependendo da
  // demora) recusar a abertura em silêncio — sem erro nenhum, o documento
  // simplesmente "não abre", mesmo existindo e tendo permissão de sobra.
  const novaAba = window.open("", "_blank");

  const original = btn.innerHTML;
  btn.classList.add("btn-loading");
  btn.innerHTML = ICONS.spinner + " Baixando...";
  btn.disabled = true;

  // 5 minutos em vez de 60s — tempo curto demais já causou confusão em
  // conexões mais lentas (a URL expirava antes do navegador terminar de
  // carregar o arquivo).
  const { data, error } = await sb.storage.from("documentos").createSignedUrl(storagePath, 300);

  btn.classList.remove("btn-loading");
  btn.innerHTML = original;
  btn.disabled = false;

  if (error || !data || !data.signedUrl) {
    if (novaAba) novaAba.close();
    showToast("Não foi possível baixar " + fileName + ". Tente novamente.");
    return;
  }

  if (novaAba) {
    novaAba.location.href = data.signedUrl;
  } else {
    // Mesmo abrindo em branco antes do await, o navegador ainda pode
    // recusar (configuração muito restritiva) — cai pro window.open direto,
    // que ao menos funciona quando pop-up pra esse site já está liberado.
    window.open(data.signedUrl, "_blank");
  }
}

// Tipos que o navegador consegue mostrar direto num <img> — o resto (XML,
// por exemplo) não tem como renderizar inline, só baixar.
const TIPOS_IMAGEM_PREVIEW = new Set(["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG"]);

/* Preenche um "palco" de pré-visualização (elemento com a classe
   .doc-viewer-stage) com o conteúdo real do arquivo armazenado no
   Supabase Storage — mesma lógica reaproveitada entre o painel do admin
   e as telas de Documentos/Boletos do cliente, em vez de manter 3 cópias
   da mesma regra de "que tipo dá pra mostrar inline vs. só baixar".
   PDF vira <iframe> (o próprio navegador já traz páginas/zoom/scroll de
   graça), imagem vira <img>, o resto cai num aviso de "baixe pra abrir".
   downloadBtn é opcional — quando passado, já fica pronto pra baixar
   exatamente o arquivo que está sendo mostrado no momento. */
async function renderizarArquivoNoPalco(stageEl, arquivo, downloadBtn) {
  stageEl.innerHTML = `<div class="doc-viewer-empty">${ICONS.spinner}<p>Carregando...</p></div>`;
  if (downloadBtn) {
    downloadBtn.style.display = "inline-flex";
    downloadBtn.onclick = () => downloadFile(downloadBtn, arquivo.storage_path, arquivo.nome_original);
  }

  const { data, error } = await sb.storage.from("documentos").createSignedUrl(arquivo.storage_path, 300);
  if (error || !data || !data.signedUrl) {
    stageEl.innerHTML = `<div class="doc-viewer-empty">${ICONS.empty}<p>Não foi possível carregar a pré-visualização.</p></div>`;
    return;
  }

  const tipo = (arquivo.tipo_arquivo || "").toUpperCase();
  if (tipo === "PDF") {
    stageEl.innerHTML = `<iframe src="${data.signedUrl}" title="${escapeHtml(arquivo.nome_original)}"></iframe>`;
  } else if (TIPOS_IMAGEM_PREVIEW.has(tipo)) {
    stageEl.innerHTML = `<img src="${data.signedUrl}" alt="${escapeHtml(arquivo.nome_original)}">`;
  } else {
    stageEl.innerHTML = `<div class="doc-viewer-empty">${ICONS.doc}<p>Pré-visualização não disponível para arquivos .${escapeHtml(tipo)}.<br>Baixe o arquivo para abrir.</p></div>`;
  }
}
