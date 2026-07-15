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

/* ---------- Categorias de documento (store compartilhado) ----------
   Em produção isso viria do banco (Supabase). Aqui, localStorage simula
   a persistência entre as telas do admin e do cliente no protótipo. */
const CATEGORY_STORE_KEY = "trilhar-categories-v2";

const CATEGORY_GROUPS = ["Fiscal", "Jurídico", "Financeiro", "RH", "Societário", "Operacional"];
const CATEGORY_COLORS = ["navy", "gold", "green", "red", "purple", "teal", "gray"];
const CATEGORY_FILE_TYPES = ["PDF", "XML", "ZIP", "DOCX", "PNG", "JPG", "XLSM", "XLS"];

function defaultCategoryShape(overrides) {
  return Object.assign({
    slug: "", nome: "", icon: "doc", padrao: false,
    descricao: "",
    cor: "navy",
    grupo: "",
    ordem: 999,
    destaque: false,
    config: {
      obrigatoria: false,
      exibirUpload: true,
      disponivelAdmin: true,
      disponivelColaborador: true,
      multiplosArquivos: true,
      permiteSubstituicao: true,
      exigirVersaoRecente: false
    },
    validacao: { tipos: ["PDF"], tamanhoMaximoMb: 10 },
    automacoes: { notificarAdmin: false, notificarCliente: false, marcarTarefa: false, atualizarStatus: false, gerarHistorico: true },
    permissoes: { administrador: true, colaborador: true, cliente: true },
    meta: { criadaPor: "Tinaysa", criadaEm: "22/06/2026", atualizadaEm: "22/06/2026" }
  }, overrides);
}

const DEFAULT_CATEGORIES = [
  defaultCategoryShape({ slug: "boleto-honorarios", nome: "Boleto - Honorários", icon: "card", padrao: true, cor: "gold", grupo: "Financeiro", ordem: 1, destaque: true, descricao: "Boletos pelos serviços de contabilidade prestados pela Trilhar.", config: { obrigatoria: true, exibirUpload: true, disponivelAdmin: true, disponivelColaborador: true, multiplosArquivos: true, permiteSubstituicao: false, exigirVersaoRecente: true } }),
  defaultCategoryShape({ slug: "boleto-imposto", nome: "Boleto - Imposto", icon: "card", padrao: true, cor: "red", grupo: "Fiscal", ordem: 2, destaque: true, descricao: "Boletos de impostos e obrigações fiscais a pagar." }),
  defaultCategoryShape({ slug: "notas-fiscais", nome: "Notas Fiscais", icon: "doc", padrao: true, cor: "teal", grupo: "Fiscal", ordem: 3, descricao: "Notas fiscais emitidas e recebidas pela empresa.", validacao: { tipos: ["PDF", "XML", "XLSM", "XLS"], tamanhoMaximoMb: 15 } }),
  defaultCategoryShape({ slug: "cartao", nome: "Cartão CNPJ", icon: "card", padrao: true, cor: "navy", grupo: "Societário", ordem: 4, descricao: "Comprovante de inscrição e situação cadastral do CNPJ." }),
  defaultCategoryShape({ slug: "empresa", nome: "Documentos da Empresa", icon: "building", padrao: true, cor: "purple", grupo: "Societário", ordem: 5, descricao: "Contrato social, alvarás e demais documentos constitutivos." }),
  defaultCategoryShape({ slug: "contrato", nome: "Contrato", icon: "contract", padrao: true, cor: "green", grupo: "Jurídico", ordem: 6, descricao: "Contratos de prestação de serviço firmados com o cliente." }),
  defaultCategoryShape({ slug: "declaracoes", nome: "Declarações", icon: "chart", padrao: true, cor: "gray", grupo: "Fiscal", ordem: 7, descricao: "Declarações fiscais e demonstrativos entregues ao cliente." })
];

const Categories = {
  getAll() {
    const raw = safeStorage.getItem(CATEGORY_STORE_KEY);
    if (!raw) {
      safeStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(DEFAULT_CATEGORIES));
      return DEFAULT_CATEGORIES.slice();
    }
    try {
      const parsed = JSON.parse(raw);
      // Categorias salvas em versões antigas do protótipo podem não ter os campos novos —
      // preenche com o padrão pra nunca quebrar a tela ao ler dados antigos.
      return parsed.map(c => defaultCategoryShape(c));
    } catch (e) {
      return DEFAULT_CATEGORIES.slice();
    }
  },
  slugify(nome) {
    return nome.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  },
  create(fields) {
    const cats = this.getAll();
    const slug = this.slugify(fields.nome);
    if (!slug || cats.some(c => c.slug === slug)) return null;
    const agora = new Date().toLocaleDateString("pt-BR");
    const nova = defaultCategoryShape(Object.assign({}, fields, {
      slug,
      padrao: false,
      meta: { criadaPor: "Tinaysa", criadaEm: agora, atualizadaEm: agora }
    }));
    cats.push(nova);
    safeStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(cats));
    return nova;
  },
  add(nome, icon) {
    return this.create({ nome, icon });
  },
  remove(slug) {
    const cats = this.getAll().filter(c => c.slug !== slug || c.padrao);
    safeStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(cats));
  },
  blank() {
    return defaultCategoryShape({});
  },
  update(slug, changes) {
    const cats = this.getAll();
    const cat = cats.find(c => c.slug === slug);
    if (!cat) return null;
    Object.assign(cat, changes);
    cat.meta = Object.assign({}, cat.meta, { atualizadaEm: new Date().toLocaleDateString("pt-BR") });
    safeStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(cats));
    return cat;
  }
};

/* ---------- Papel de acesso (Proprietário / Administrador / Usuário comum) ----------
   Não existe login multiusuário real neste protótipo, então simulamos a troca de
   papel pelo menu da conta — isso permite demonstrar as 3 permissões pra cliente
   sem precisar de um backend de autenticação. */
const ROLE_KEY = "trilhar-role";
const ROLES = {
  proprietario: { label: "Proprietário", podeGerenciarPadrao: true, podeForcarRemocao: true },
  administrador: { label: "Administrador", podeGerenciarPadrao: false, podeForcarRemocao: false },
  usuario: { label: "Usuário comum", podeGerenciarPadrao: false, podeForcarRemocao: false, somenteLeitura: true }
};
const Role = {
  get() {
    return safeStorage.getItem(ROLE_KEY) || "proprietario";
  },
  set(role) {
    safeStorage.setItem(ROLE_KEY, role);
  },
  info() {
    return ROLES[this.get()] || ROLES.proprietario;
  },
  podeEditarCategoria(cat) {
    const r = this.info();
    if (r.somenteLeitura) return false;
    if (cat.padrao) return r.podeGerenciarPadrao || this.get() === "administrador"; // ícone só, nome nunca
    return true;
  },
  podeRemoverCategoria(cat, temDocumentosVinculados) {
    const r = this.info();
    if (r.somenteLeitura || cat.padrao) return false;
    if (temDocumentosVinculados && !r.podeForcarRemocao) return false;
    return true;
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

/* Regra de negócio: só boleto tem vencimento e status de pagamento (binário
   pago/nao_pago no banco). "Vencendo"/"Vencido" não existem como valores
   guardados — são calculados aqui a partir de data_vencimento vs hoje, só
   pra exibição. Documentos sem data_vencimento (tudo que não é boleto) não
   têm status algum: retorna null e a tela não mostra nenhuma tag. */
function statusBoleto(doc) {
  if (!doc.data_vencimento) return null;
  if (doc.status === "pago") return { label: "Pago", cls: "ok" };

  const dias = Math.round((new Date(doc.data_vencimento) - new Date()) / 86400000);
  if (dias < 0) return { label: "Vencido", cls: "danger", dias };
  if (dias <= 7) return { label: "Vence em " + dias + (dias === 1 ? " dia" : " dias"), cls: "warning", dias };
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
