// Avisos en la app (notificaciones «push»): este dispositivo acepta recibirlos y se lo decimos al servidor.
// El envío lo hace el robot semanal (pipeline/avisos.py) cuando hay una vacante nueva o una adjudicación en un centro favorito.
import { rpc, CUENTA, cargarPerfil } from "./cuenta.js";

export const soportaAvisos = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Registra el service worker (sw.js). Sin él no hay avisos ni se puede instalar la web como app. */
export async function registrarSW() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("sw.js"); } catch (e) { console.warn("sw", e); return null; }
}

function aBytes(b64u) {
  const b = (b64u + "=".repeat((4 - (b64u.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}
const igual = (buf, bytes) => !!buf && new Uint8Array(buf).length === bytes.length && new Uint8Array(buf).every((x, i) => x === bytes[i]);

async function suscripcionActual() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** { soportado, permiso: default | granted | denied, suscrito } de ESTE dispositivo. */
export async function estadoDispositivo() {
  if (!soportaAvisos()) return { soportado: false, permiso: "denied", suscrito: false };
  let suscrito = false;
  try { suscrito = !!(await suscripcionActual()); } catch (e) { /* nada */ }
  return { soportado: true, permiso: Notification.permission, suscrito };
}

async function enviarDispositivo(sub) {
  const j = sub.toJSON();
  const r = await rpc("guardar_dispositivo", { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth });
  return r.estado === "ok";
}

/** Pide permiso y activa los avisos en este dispositivo. Devuelve ok | no_soportado | denegado | sin_clave | error. */
export async function activarAvisos() {
  if (!soportaAvisos()) return "no_soportado";
  try {
    const reg = (await registrarSW()) && (await navigator.serviceWorker.ready);
    if (!reg) return "no_soportado";
    const permiso = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permiso !== "granted") return "denegado";
    const clave = await rpc("vapid_publica");
    if (!clave) return "sin_clave";           // el robot aún no ha creado las claves (se crean en su primera ejecución)
    const bytes = aBytes(clave);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !igual(sub.options?.applicationServerKey, bytes)) { await sub.unsubscribe(); sub = null; }   // claves antiguas
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    if (!(await enviarDispositivo(sub))) return "error";
    await cargarPerfil();
    return "ok";
  } catch (e) { console.warn("activarAvisos", e); return "error"; }
}

/** Quita los avisos de este dispositivo. */
export async function desactivarAvisos() {
  try {
    const sub = await suscripcionActual();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try { await rpc("quitar_dispositivo", { p_endpoint: endpoint }); } catch (e) { /* el robot lo dará de baja cuando el servicio de avisos diga que ya no existe */ }
    }
    await cargarPerfil();
    return true;
  } catch (e) { return false; }
}

/** Al entrar: si este dispositivo ya tenía avisos, se lo recordamos a la cuenta (por si el navegador renovó la suscripción o cambió de cuenta). */
export async function resincronizarAvisos() {
  if (!soportaAvisos() || CUENTA.estado === "anonimo" || Notification.permission !== "granted") return;
  try { const sub = await suscripcionActual(); if (sub) await enviarDispositivo(sub); } catch (e) { /* no pasa nada */ }
}
