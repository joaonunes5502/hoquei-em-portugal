// Service worker do Hóquei em Português: app instalável, funciona com rede fraca e mostra notificações.
const CACHE = "hp-v1";
const BASE = ["/", "/index.html", "/estilo.css", "/app.js", "/config.js", "/demo.js", "/logo-dia.png", "/logo-noite.png", "/icones/icon-192.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

// rede primeiro (dados sempre frescos); se não houver rede, usa a última versão guardada
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("/index.html"))));
});

self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "Hóquei em Português", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Hóquei em Português", {
    body: d.body || "", tag: d.tag, renotify: true, data: { url: d.url || "/" },
    icon: "/icones/icon-192.png", badge: "/icones/icon-192.png"
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || "/", location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if (w.url.startsWith(location.origin)) { w.focus(); return w.navigate(url); } }
    return self.clients.openWindow(url);
  }));
});
