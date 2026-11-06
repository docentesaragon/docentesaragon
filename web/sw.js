// Service worker de Docentes Aragón: solo sirve para recibir avisos (no guarda páginas en caché ni cambia cómo carga la web).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
