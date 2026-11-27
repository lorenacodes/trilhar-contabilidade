/* Service worker do Portal Trilhar -- deliberadamente simples e conservador.
   Objetivo: o site poder ser instalado como app e abrir mais rápido, SEM nunca
   mostrar dado velho nem interferir no login.
   - Só mexe em requisições do PRÓPRIO site (mesma origem). Supabase, fontes e
     CDNs passam direto pelo navegador, sem passar por aqui.
   - Páginas (HTML): sempre tenta a rede primeiro; só se estiver sem internet
     mostra a página "Sem conexão". Nunca serve uma página guardada com a rede
     funcionando, então um deploy novo chega na hora.
   - Arquivos estáticos (css, js, imagens): mostra a cópia guardada na hora e
     atualiza em segundo plano pra próxima abertura.
   - Nenhum dado de cliente é guardado: os dados vêm do Supabase (não passa
     por aqui) e as páginas HTML não são guardadas. */
const VERSAO = "trilhar-v3";
const OFFLINE_URL = "/offline.html";
const PRE_CACHE = [OFFLINE_URL, "/img/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSAO).then((c) => c.addAll(PRE_CACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  if (/\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSAO).then(async (cache) => {
        const guardado = await cache.match(req);
        const daRede = fetch(req).then((resp) => {
          if (resp && resp.ok) cache.put(req, resp.clone());
          return resp;
        }).catch(() => guardado);
        return guardado || daRede;
      })
    );
  }
});
