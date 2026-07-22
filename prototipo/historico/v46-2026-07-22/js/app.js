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
  card: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  building: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/></svg>',
  contract: '<svg class="icon" viewBox="0 0 24 24"><path d="M16 2H8a2 2 0 00-2 2v16a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  chart: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 5-7"/></svg>',
  download: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/></svg>',
  spinner: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-9-9"/></svg>',
  empty: '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h3"/></svg>',
  mail: '<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 6l10 7 10-7"/></svg>',
  camera: '<svg class="icon" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h3l2-3h8l2 3h3a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
  dot: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  eye: '<svg class="icon" viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  phone: '<svg class="icon" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.9a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.4 1.9.6 2.9.7a2 2 0 011.7 2z"/></svg>',
  kebab: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  edit: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  lock: '<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>'
};

/* Navegação compartilhada das páginas novas do cliente (Dashboard, Boletos,
   Documentos, Enviar Documento, Perfil) — sidebar no desktop/tablet, barra
   inferior no mobile (troca via CSS, o mesmo HTML serve pros dois). Um único
   ponto de manutenção evita que 5 páginas fiquem com a nav dessincronizada. */
const NAV_ITEMS = [
  { slug: "dashboard", label: "Dashboard", icon: "chart", href: "dashboard.html" },
  { slug: "boletos", label: "Boletos", icon: "card", href: "boletos.html" },
  { slug: "documentos", label: "Documentos", icon: "doc", href: "documentos.html" },
  { slug: "enviar", label: "Enviar Documento", icon: "download", href: "enviar-documento.html" },
  { slug: "perfil", label: "Perfil", icon: "user", href: "perfil.html" }
];

function renderNav(paginaAtiva) {
  const appBody = document.querySelector(".app-body");

  const sidebar = document.createElement("nav");
  sidebar.className = "nav-sidebar";
  sidebar.innerHTML = NAV_ITEMS.map(item => `
    <a class="nav-item${item.slug === paginaAtiva ? " active" : ""}" href="${item.href}">
      <span class="nav-item-icon">${ICONS[item.icon]}</span>
      <span class="nav-item-label">${item.label}</span>
    </a>
  `).join("");
  if (appBody) appBody.insertBefore(sidebar, appBody.firstChild);

  const bottomNav = document.createElement("nav");
  bottomNav.className = "nav-bottom";
  bottomNav.innerHTML = NAV_ITEMS.map(item => `
    <a class="nav-bottom-item${item.slug === paginaAtiva ? " active" : ""}" href="${item.href}">
      <span class="nav-bottom-icon">${ICONS[item.icon]}</span>
      <span>${item.label.split(" ")[0]}</span>
    </a>
  `).join("");
  document.body.appendChild(bottomNav);
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
  toast.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg><span>' + message + "</span>";
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

/* Download real (Supabase Storage), usado nas páginas do cliente (categoria.html).
   admin.html continua com simulateDownload acima — não muda nesta fase. */
async function downloadFile(btn, storagePath, fileName) {
  const original = btn.innerHTML;
  btn.classList.add("btn-loading");
  btn.innerHTML = ICONS.spinner + " Baixando...";
  btn.disabled = true;

  const { data, error } = await sb.storage.from("documentos").createSignedUrl(storagePath, 60);

  btn.classList.remove("btn-loading");
  btn.innerHTML = original;
  btn.disabled = false;

  if (error || !data || !data.signedUrl) {
    showToast("Não foi possível baixar " + fileName + ". Tente novamente.");
    return;
  }
  window.open(data.signedUrl, "_blank");
}
