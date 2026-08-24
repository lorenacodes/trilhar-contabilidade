(function () {
  const saved = localStorage.getItem("trilhar-theme") || "light";
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
        localStorage.setItem("trilhar-theme", next);
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
  phone: '<svg class="icon" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.9a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.4 1.9.6 2.9.7a2 2 0 011.7 2z"/></svg>'
};

/* ---------- Categorias de documento (store compartilhado) ----------
   Em produção isso viria do banco (Supabase). Aqui, localStorage simula
   a persistência entre as telas do admin e do cliente no protótipo. */
const CATEGORY_STORE_KEY = "trilhar-categories";
const DEFAULT_CATEGORIES = [
  { slug: "boleto", nome: "Boleto", icon: "card", padrao: true },
  { slug: "cartao", nome: "Cartão CNPJ", icon: "card", padrao: true },
  { slug: "empresa", nome: "Documentos da Empresa", icon: "building", padrao: true },
  { slug: "contrato", nome: "Contrato", icon: "contract", padrao: true },
  { slug: "declaracoes", nome: "Declarações", icon: "chart", padrao: true }
];

const Categories = {
  getAll() {
    const raw = localStorage.getItem(CATEGORY_STORE_KEY);
    if (!raw) {
      localStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(DEFAULT_CATEGORIES));
      return DEFAULT_CATEGORIES.slice();
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return DEFAULT_CATEGORIES.slice();
    }
  },
  add(nome, icon) {
    const cats = this.getAll();
    const slug = nome.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (cats.some(c => c.slug === slug)) return null;
    const nova = { slug, nome: nome.trim(), icon: icon || "doc", padrao: false };
    cats.push(nova);
    localStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(cats));
    return nova;
  },
  remove(slug) {
    const cats = this.getAll().filter(c => c.slug !== slug || c.padrao);
    localStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(cats));
  }
};

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
