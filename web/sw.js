// Service worker de Docentes Aragón: recibe los avisos y, si no hay conexión al abrir la web, enseña una pantalla de «Sin conexión»
// con botón de reintentar. No guarda en caché la web (siempre se carga de internet), solo esa pantalla.
const CACHE = "docentes-aragon-sin-conexion-v1";
const SIN_CONEXION = "offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    try { await (await caches.open(CACHE)).add(new Request(SIN_CONEXION, { cache: "reload" })); } catch (_) { /* sin pantalla guardada: no pasa nada */ }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  try { for (const nombre of await caches.keys()) if (nombre !== CACHE) await caches.delete(nombre); } catch (_) { /* nada */ }
  await self.clients.claim();
})()));

// Solo al abrir una página (navegación): primero internet; si falla (sin conexión), la pantalla de «Sin conexión».
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(async () => (await caches.match(SIN_CONEXION)) || new Response("Sin conexión a internet. Vuelve a intentarlo.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
});

// Llega un aviso del robot semanal: { t: título, b: texto, u: dirección (#/...), g: etiqueta para no repetirlo }
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { b: e.data ? e.data.text() : "" }; }
  if (!d || typeof d !== "object") d = {};
  e.waitUntil(self.registration.showNotification(String(d.t || "Docentes Aragón").slice(0, 100), {
    body: String(d.b || "").slice(0, 200),
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: String(d.g || "aviso").slice(0, 120),
    data: { u: typeof d.u === "string" && d.u.startsWith("#/") ? d.u : "#/yo" },
  }));
});

// Al tocar el aviso: abre la web en la pantalla que toca (o reutiliza la ventana que ya estuviera abierta).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.u) || "#/yo", self.registration.scope).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const v of ventanas) {
      if (v.url.startsWith(self.registration.scope)) {
        try { await v.focus(); if ("navigate" in v) await v.navigate(destino); } catch (_) { /* si no se puede, abrimos una nueva */ continue; }
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
