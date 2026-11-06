// Cuenta de usuario (correo y contraseña con Supabase Auth, igual que DocentsCV; Google queda preparado pero apagado),
// pase (compra, prueba gratuita o app gratis por invitar), invitaciones y sincronización de "Mi seguimiento".
// Sin dependencias: habla directamente con la API de Supabase (Auth, REST y funciones).
import { leerLocal, guardarLocal, debounce } from "./util.js";
import { YO, MODO_CUENTA, ESQUEMA, enlace, CLAVE_ANTIGUA } from "./datos.js";

const cfg = window.CONFIG || {};
const URL_SB = (cfg.supabaseUrl || "").replace(/\/$/, "");
const CLAVE_SESION = "docentes-aragon:sesion";
const CLAVE_REF = "docentes-aragon:ref";     // código de invitación que trae el enlace (?ref=ARA-XXXXX), hasta que se use
const VERSION_PRIVACIDAD = "2026-11-06-v3.3";   // versión de privacidad/condiciones que se acepta al crear la cuenta (privacidad.html)

export const CUENTA = {
  activa: MODO_CUENTA,
  estado: "anonimo",        // anonimo | sin_pase | con_pase
  email: "",
  pase: null,               // pase en vigor: { curso, expira, tipo: suscripcion | pago_unico | prueba | invitaciones | manual }
  ultimoPase: null,         // el más reciente, aunque haya caducado
  invitacion: false,        // true si llegó desde un enlace de invitación (?ref=...) y aún no tiene cuenta
  mensaje: "",              // aviso para enseñar en "Mi seguimiento" (errores de login, etc.)
  recuperando: false,       // true si se llega desde el enlace de «he olvidado mi contraseña»: toca elegir una nueva
  sync: "",                 // "", "guardando", "guardado" o "error"
  perfil: null,             // { nombre, casa, avisos: {favoritos}, dispositivos, cambios_restantes, busquedas_restantes, admin } (función mi_perfil)
  admin: false,             // true si es administradora (solo docentscv@gmail.com; lo decide el servidor, no la web)
  verComo: null,            // { user_id, email, nombre } mientras el administrador mira la web como otra persona (solo lectura)
};

/** ¿Puede esta persona usar las funciones personales (listas y destinos)? */
export const puedeSeguir = () => !CUENTA.activa || CUENTA.estado === "con_pase";

const hoyUTC = () => new Date().toISOString().slice(0, 10);
/** Días que le quedan a la prueba gratuita (contando hoy); 0 si no está en prueba. */
export function diasDePrueba() {
  const p = CUENTA.pase;
  if (!p || p.tipo !== "prueba") return 0;
  return Math.max(0, Math.round((Date.parse(p.expira) - Date.parse(hoyUTC())) / 86400000) + 1);
}
const ahoraSeg = () => Math.floor(Date.now() / 1000);

// ---------- sesión ----------
let sesion = null;   // { access_token, refresh_token, expires_at }

function datosDelToken(jwt) {
  try {
    const b = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(b + "=".repeat((4 - (b.length % 4)) % 4)))));
  } catch (e) { return {}; }
}
function fijarSesion(s) {
  sesion = s;
  if (s) { guardarLocal(CLAVE_SESION, s); CUENTA.email = datosDelToken(s.access_token).email || ""; }
  else { try { localStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ } CUENTA.email = ""; }
}

/** Al volver de un enlace del correo (confirmar cuenta, recuperar contraseña) o de Google, Supabase deja la sesión en la dirección
 *  (#access_token=...&type=...). La guardamos y limpiamos la dirección. */
function recogerSesionDeLaUrl() {
  const h = location.hash;
  if (!h.startsWith("#access_token=") && !h.startsWith("#error=")) return false;
  const p = new URLSearchParams(h.slice(1));
  history.replaceState(null, "", location.pathname + location.search + "#/yo");
  if (p.get("error")) {
    CUENTA.mensaje = /expired|invalid/i.test((p.get("error_code") || "") + " " + (p.get("error_description") || ""))
      ? "El enlace ha caducado o ya se ha usado. Pide otro desde «He olvidado mi contraseña», o entra con tu correo y contraseña."
      : "No se ha podido completar la entrada. Inténtalo de nuevo.";
    return true;
  }
  fijarSesion({
    access_token: p.get("access_token"), refresh_token: p.get("refresh_token") || "",
    expires_at: +p.get("expires_at") || ahoraSeg() + (+p.get("expires_in") || 3600),
  });
  if (p.get("type") === "recovery") CUENTA.recuperando = true;
  return true;
}

async function refrescar() {
  if (!sesion?.refresh_token) { fijarSesion(null); return false; }
  try {
    const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: sesion.refresh_token }),
    });
    if (!r.ok) { fijarSesion(null); return false; }
    const j = await r.json();
    fijarSesion({ access_token: j.access_token, refresh_token: j.refresh_token || sesion.refresh_token, expires_at: j.expires_at || ahoraSeg() + (j.expires_in || 3600) });
    return true;
  } catch (e) { return false; }   // sin red: se conserva la sesión y se reintenta luego
}

/** Petición a la API de Supabase con la sesión del usuario. */
export async function api(ruta, { metodo = "GET", cuerpo, prefer, perfil = true } = {}, reintento = true) {
  if (sesion && sesion.expires_at - 60 < ahoraSeg()) await refrescar();
  const cab = { apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + (sesion?.access_token || cfg.supabaseAnonKey) };
  if (cuerpo !== undefined) cab["Content-Type"] = "application/json";
  if (perfil) { cab["Accept-Profile"] = ESQUEMA; cab["Content-Profile"] = ESQUEMA; }
  if (prefer) cab.Prefer = prefer;
  const r = await fetch(`${URL_SB}${ruta}`, { method: metodo, headers: cab, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  if (r.status === 401 && reintento && sesion && await refrescar()) return api(ruta, { metodo, cuerpo, prefer, perfil }, false);
  return r;
}

export const tokenActual = () => sesion?.access_token || "";

// ---------- pase ----------
function actualizarEstado() {
  if (!sesion) CUENTA.estado = "anonimo";
  else CUENTA.estado = CUENTA.pase ? "con_pase" : "sin_pase";
}
export async function cargarPase() {
  CUENTA.pase = null; CUENTA.ultimoPase = null;
  const r = await api("/rest/v1/pases?select=curso,expira,estado,tipo&estado=eq.activo&order=expira.desc&limit=1");
  if (!r.ok) throw new Error(`No se pudo consultar el pase (${r.status})`);
  const [p] = await r.json();
  CUENTA.ultimoPase = p || null;
  CUENTA.pase = p && p.expira >= hoyUTC() ? p : null;
  if (CUENTA.admin && !CUENTA.pase) CUENTA.pase = { tipo: "admin", curso: "", expira: "2099-12-31" };   // el administrador entra siempre
  actualizarEstado();
}

/** Llama a una función de la base de datos (rpc). Devuelve lo que responde o lanza un Error si el servidor la rechaza. */
export async function rpc(nombre, cuerpo = {}) {
  const r = await api(`/rest/v1/rpc/${nombre}`, { metodo: "POST", cuerpo });
  if (!r.ok) {
    let m = ""; try { m = (await r.json()).message || ""; } catch (e) { /* sin cuerpo */ }
    const err = new Error(m || `Error ${r.status}`); err.estado = r.status; throw err;
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---------- nombre, búsqueda automática de listas, mensajes ----------
export async function cargarPerfil() {
  try { CUENTA.perfil = await rpc("mi_perfil"); CUENTA.admin = !!CUENTA.perfil?.admin; }
  catch (e) { console.warn("mi_perfil", e); CUENTA.perfil = null; CUENTA.admin = false; }
}
export const ERRORES_NOMBRE = {
  invalido: "Escribe tus apellidos y tu nombre, tal como salen en las listas (por ejemplo: GARCÍA LÓPEZ, MARÍA).",
  limite: "Ya has cambiado el nombre 3 veces. Escríbenos desde «Sugerencias y reclamaciones» y lo corregimos.",
  error: "No se pudo guardar el nombre. Inténtalo de nuevo.",
};
/** ¿Parece un nombre completo (al menos dos palabras)? Lo mismo que exige el servidor. */
export const nombreValido = (n) => (n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]+/g, " ").trim().split(" ").filter(Boolean).length >= 2 && (n || "").trim().length >= 5;
/** Guarda el nombre de la cuenta. Devuelve ok | invalido | limite | error. */
export async function guardarNombre(nombre) {
  try {
    const r = await rpc("guardar_nombre", { p_nombre: nombre });
    if (r.estado === "ok") await cargarPerfil();
    return r.estado;
  } catch (e) { return "error"; }
}
/** Busca en las listas del curso a la persona con el nombre de esta cuenta. Devuelve { estado: ok | varios | no_encontrado | limite | sin_nombre | sin_pase | error, listas?, restantes? }. */
export async function buscarMisListas(nif = "") {
  try {
    const r = await rpc("buscar_mis_listas", { p_nif: nif || null });
    if (CUENTA.perfil && r.restantes != null) CUENTA.perfil.busquedas_restantes = r.restantes;
    return r;
  } catch (e) { return { estado: "error" }; }
}
/** Guarda el municipio de la cuenta («Utebo (Zaragoza)»; "" lo quita). Devuelve ok | invalido | error. */
export async function guardarCasa(casa) {
  try {
    const r = await rpc("guardar_casa", { p_casa: casa });
    if (r.estado === "ok") await cargarPerfil();
    return r.estado;
  } catch (e) { return "error"; }
}
/** Qué avisos quiere recibir, p. ej. { favoritos: true }. Devuelve true si se guardó. */
export async function guardarAvisos(avisos) {
  try {
    const r = await rpc("guardar_avisos", { p_avisos: avisos });
    if (CUENTA.perfil) CUENTA.perfil.avisos = r;
    return true;
  } catch (e) { return false; }
}
/** Sugerencia o reclamación para la administración. Devuelve ok | invalido | limite | error. */
export async function enviarMensaje(tipo, texto) {
  try { return (await rpc("enviar_mensaje", { p_tipo: tipo, p_texto: texto })).estado; } catch (e) { return "error"; }
}
export async function misMensajes() {
  try {
    const r = await api("/rest/v1/mensajes?select=id,tipo,texto,estado,respuesta,creado&order=creado.desc&limit=50");
    return r.ok ? await r.json() : [];
  } catch (e) { return []; }
}

// ---------- administración (el servidor comprueba siempre que quien llama es administradora) ----------
export const adminResumen = () => rpc("admin_resumen");
export const adminUsuarios = (buscar = "", desde = 0, limite = 50) => rpc("admin_usuarios", { p_buscar: buscar || null, p_desde: desde, p_limite: limite });
export const adminEmbudo = () => rpc("admin_embudo");
export const adminPruebasTerminadas = (dias = 22) => rpc("admin_pruebas_terminadas", { p_dias: dias });
/** accion: regalar | ampliar_prueba | anular | nombre. Devuelve ok | ya_tiene | invalido | no_existe | ... */
export const adminAccion = (user, accion, valor = null) => rpc("admin_accion", { p_user: user, p_accion: accion, p_valor: valor });
export const adminMensajes = (estado = null) => rpc("admin_mensajes", { p_estado: estado });
export const adminResponder = (id, estado, respuesta = null) => rpc("admin_responder", { p_id: id, p_estado: estado, p_respuesta: respuesta });

let copiaYo = null;
/** «Ver la web como otra persona»: carga sus listas y destinos en pantalla, en solo lectura (no se guarda nada). Queda anotado en el servidor. */
export async function verComo(userId) {
  const r = await rpc("admin_ver_seguimiento", { p_user: userId });
  if (!r) throw new Error("No existe esa persona.");
  if (!CUENTA.verComo) copiaYo = { listas: YO.listas, destinos: YO.destinos, favoritos: YO.favoritos };
  YO.listas = r.datos?.listas || []; YO.destinos = r.datos?.destinos || []; YO.favoritos = favoritosValidos(r.datos?.favoritos);
  CUENTA.verComo = { user_id: userId, email: r.email, nombre: r.nombre };
}
export function salirVerComo() {
  if (!CUENTA.verComo) return;
  YO.listas = copiaYo?.listas || []; YO.destinos = copiaYo?.destinos || []; YO.favoritos = copiaYo?.favoritos || []; CUENTA.verComo = null; copiaYo = null;
}

// PDF de Educaragón que sube la administradora (Storage privado «aragon-pdf»); el robot semanal los procesa y los borra.
async function conSesion() {
  if (sesion && sesion.expires_at - 60 < ahoraSeg()) await refrescar();
  return { apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + (sesion?.access_token || cfg.supabaseAnonKey) };
}
export async function adminListarPdf() {
  const r = await fetch(`${URL_SB}/storage/v1/object/list/aragon-pdf`, { method: "POST", headers: { ...(await conSesion()), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 100, offset: 0, sortBy: { column: "name", order: "desc" } }) });
  if (!r.ok) throw new Error(`No se pudo leer la lista de PDF (${r.status})`);
  return (await r.json()).filter((o) => o.id && /\.pdf$/i.test(o.name)).map((o) => ({ nombre: o.name, bytes: o.metadata?.size || 0 }));
}
export async function adminSubirPdf(archivo) {
  if (!/\.pdf$/i.test(archivo.name)) return { ok: false, mensaje: `${archivo.name}: solo se admiten archivos PDF.` };
  if (archivo.size > 30 * 1024 * 1024) return { ok: false, mensaje: `${archivo.name}: pesa más de 30 MB.` };
  if ((await archivo.slice(0, 5).text()) !== "%PDF-") return { ok: false, mensaje: `${archivo.name}: no parece un PDF.` };
  const limpio = archivo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._ -]+/g, "_");
  const nombre = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}-${limpio}`;
  try {
    const r = await fetch(`${URL_SB}/storage/v1/object/aragon-pdf/${encodeURIComponent(nombre)}`, { method: "POST", body: archivo,
      headers: { ...(await conSesion()), "Content-Type": "application/pdf", "x-upsert": "false" } });
    if (!r.ok) return { ok: false, mensaje: `${archivo.name}: no se pudo subir (${r.status}).` };
    return { ok: true, nombre };
  } catch (e) { return { ok: false, mensaje: `${archivo.name}: no hay conexión.` }; }
}
export async function adminBorrarPdf(nombre) {
  const r = await fetch(`${URL_SB}/storage/v1/object/aragon-pdf`, { method: "DELETE", headers: { ...(await conSesion()), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [nombre] }) });
  return r.ok;
}

// ---------- seguimiento sincronizado ----------
/** Centros favoritos guardados: [{ cod, centro, localidad, provincia, desde }]. Se descarta lo que no tenga forma de favorito (máx. 100). */
function favoritosValidos(lista) {
  return (Array.isArray(lista) ? lista : []).filter((f) => f && typeof f === "object" && typeof f.cod === "string" && f.cod).slice(0, 100)
    .map((f) => ({ cod: f.cod, centro: String(f.centro || ""), localidad: String(f.localidad || ""), provincia: String(f.provincia || ""), desde: typeof f.desde === "string" ? f.desde : "" }));
}
async function cargarSeguimiento() {
  const r = await api("/rest/v1/seguimiento?select=datos&limit=1");
  if (!r.ok) throw new Error(`No se pudo leer tu seguimiento (${r.status})`);
  const [fila] = await r.json();
  if (fila) {
    YO.listas = fila.datos?.listas || []; YO.destinos = fila.datos?.destinos || []; YO.favoritos = favoritosValidos(fila.datos?.favoritos);
    return;
  }
  // Cuenta sin datos todavía: se importa lo que hubiera guardado en este navegador de una versión anterior.
  const viejo = leerLocal(CLAVE_ANTIGUA, null);
  if (viejo && ((viejo.listas || []).length || (viejo.destinos || []).length)) {
    YO.listas = viejo.listas || []; YO.destinos = viejo.destinos || [];
    if (await subir()) { try { localStorage.removeItem(CLAVE_ANTIGUA); } catch (e) { /* nada */ } }
  }
}
async function subir() {
  CUENTA.sync = "guardando"; avisar();
  try {
    const usuario = datosDelToken(sesion.access_token).sub;
    const r = await api("/rest/v1/seguimiento?on_conflict=user_id", {
      metodo: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      cuerpo: { user_id: usuario, datos: { listas: YO.listas, destinos: YO.destinos, favoritos: YO.favoritos }, actualizado: new Date().toISOString() },
    });
    CUENTA.sync = r.ok ? "guardado" : "error";
  } catch (e) { CUENTA.sync = "error"; }
  avisar();
  return CUENTA.sync === "guardado";
}
const subirTarde = debounce(() => { if (CUENTA.estado === "con_pase") subir(); }, 600);
if (MODO_CUENTA) enlace.alGuardar = () => { if (CUENTA.verComo) return; if (CUENTA.estado === "con_pase") { CUENTA.sync = "guardando"; avisar(); subirTarde(); } };

/** Texto del estado de sincronización, en un elemento con id="sync-estado" si está en pantalla. */
export const TEXTO_SYNC = { "": "", guardando: "Guardando…", guardado: "Guardado en tu cuenta.", error: "No se pudo guardar en tu cuenta. Comprueba la conexión y vuelve a intentarlo." };
function avisar() {
  const el = document.getElementById("sync-estado");
  if (el) { el.textContent = TEXTO_SYNC[CUENTA.sync]; el.classList.toggle("error-txt", CUENTA.sync === "error"); }
}

// ---------- acciones ----------
/** Con la sesión ya puesta: mira si hay pase vigente y, si lo hay, trae el seguimiento. */
async function cargarCuentaDeLaSesion() {
  actualizarEstado();
  try {
    // La primera vez que entra, el servidor crea su cuenta de Docentes Aragón con la prueba gratuita y su código de invitación.
    try { await api("/rest/v1/rpc/mi_acceso", { metodo: "POST", cuerpo: {} }); } catch (e) { console.warn("mi_acceso", e); }
    await cargarPerfil();      // antes que el pase: el administrador entra siempre
    await cargarPase();
    if (CUENTA.estado === "con_pase") await cargarSeguimiento();
  } catch (e) {
    console.warn(e);
    CUENTA.mensaje = "No se ha podido comprobar tu cuenta ahora mismo. Recarga la página en unos minutos.";
  }
}
/** Enlace de invitación: https://.../?ref=ARA-XXXXX. Guarda el código, limpia la dirección y lleva a la pantalla de crear cuenta. */
function recogerCodigoDeLaUrl() {
  const m = /[?&]ref=([A-Za-z0-9-]{4,16})/.exec(location.search);
  if (!m) return false;
  guardarLocal(CLAVE_REF, m[1].toUpperCase());
  history.replaceState(null, "", location.pathname + "#/yo");
  return true;
}
export const codigoPendiente = () => leerLocal(CLAVE_REF, "");
export function olvidarCodigo() { try { localStorage.removeItem(CLAVE_REF); } catch (e) { /* nada */ } }

export async function iniciarCuenta() {
  if (!CUENTA.activa) return;
  const conEnlace = recogerCodigoDeLaUrl();
  recogerSesionDeLaUrl();
  if (!sesion) sesion = leerLocal(CLAVE_SESION, null);
  if (sesion) CUENTA.email = datosDelToken(sesion.access_token).email || "";
  actualizarEstado();
  if (conEnlace && !sesion) CUENTA.invitacion = true;
  if (!sesion) { CUENTA.recuperando = false; return; }
  if (sesion.expires_at - 60 < ahoraSeg() && !(await refrescar())) { actualizarEstado(); CUENTA.recuperando = false; if (!sesion) return; }
  await cargarCuentaDeLaSesion();
}

// ---------- entrada con correo y contraseña (Supabase Auth; igual que DocentsCV) ----------
const vuelta = () => location.origin + location.pathname;   // adonde vuelven los enlaces del correo

/** Mensajes de error de Supabase Auth en castellano (mismos textos que DocentsCV). */
function textoError(j, estado) {
  const cod = String(j.error_code || j.code || ""), txt = String(j.msg || j.error_description || j.message || j.error || "");
  const todo = cod + " " + txt;
  if (/invalid_credentials|invalid login/i.test(todo)) return "Correo o contraseña incorrectos.";
  if (/email_not_confirmed|not confirmed/i.test(todo)) return "Aún no has confirmado tu correo. Revisa tu bandeja de entrada.";
  if (estado === 429 || /rate.?limit|too many/i.test(todo)) return "Demasiados intentos. Espera unos minutos.";
  if (/same_password|different from the old/i.test(todo)) return "La nueva contraseña debe ser distinta de la anterior.";
  if (/weak_password|at least \d+ char|should be at least/i.test(todo)) return "La contraseña debe tener al menos 8 caracteres.";
  if (/email_address_invalid|validate email|invalid.*email/i.test(todo)) return "Escribe un correo válido.";
  return txt || `Error ${estado}`;
}
async function auth(ruta, { metodo = "POST", cuerpo, token, volverA } = {}) {
  const url = `${URL_SB}/auth/v1${ruta}${volverA ? (ruta.includes("?") ? "&" : "?") + "redirect_to=" + encodeURIComponent(volverA) : ""}`;
  const cab = { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" };
  if (token) cab.Authorization = "Bearer " + token;
  let r;
  try { r = await fetch(url, { method: metodo, headers: cab, body: JSON.stringify(cuerpo) }); }
  catch (e) { return { ok: false, mensaje: "No hay conexión. Comprueba internet y vuelve a intentarlo." }; }
  let j = {}; try { j = await r.json(); } catch (e) { /* respuesta vacía */ }
  return r.ok ? { ok: true, datos: j } : { ok: false, mensaje: textoError(j, r.status) };
}
function sesionDeRespuesta(j) {
  fijarSesion({ access_token: j.access_token, refresh_token: j.refresh_token || "", expires_at: j.expires_at || ahoraSeg() + (j.expires_in || 3600) });
}

/** Devuelve { ok } o { ok: false, mensaje }. */
export async function entrarConCorreo(email, password) {
  const r = await auth("/token?grant_type=password", { cuerpo: { email, password } });
  if (!r.ok) return r;
  sesionDeRespuesta(r.datos); CUENTA.mensaje = "";
  await cargarCuentaDeLaSesion();
  return { ok: true };
}
/** Crea la cuenta. Con confirmación de correo (lo normal) no hay sesión hasta pulsar el enlace: { ok, sesion: false }. */
export async function crearCuenta(email, password, codigo = "", nombre = "", casa = "") {
  const datos = { acepta_privacidad_aragon: new Date().toISOString(), version_privacidad_aragon: VERSION_PRIVACIDAD };
  const cod = (codigo || "").trim().toUpperCase();
  if (cod) datos.codigo_invitacion_aragon = cod;      // el servidor lo aplica la primera vez que entre (mi_acceso)
  const nom = (nombre || "").trim();
  if (nom) datos.nombre_aragon = nom;                 // idem: se guarda como «mi nombre en las listas»
  if (casa) datos.casa_aragon = casa;                 // idem: el municipio donde vive («Utebo (Zaragoza)»)
  const r = await auth("/signup", { volverA: vuelta(), cuerpo: { email, password, data: datos } });
  if (!r.ok) return r;
  olvidarCodigo(); CUENTA.invitacion = false;
  if (r.datos.access_token) { sesionDeRespuesta(r.datos); CUENTA.mensaje = ""; await cargarCuentaDeLaSesion(); return { ok: true, sesion: true }; }
  return { ok: true, sesion: false };
}
export const recuperarContrasena = (email) => auth("/recover", { volverA: vuelta(), cuerpo: { email } });
/** Tras el enlace de recuperación: guarda la nueva contraseña y deja la sesión abierta. */
export async function nuevaContrasena(password) {
  const r = await auth("/user", { metodo: "PUT", token: sesion?.access_token, cuerpo: { password } });
  if (r.ok) { CUENTA.recuperando = false; if (CUENTA.estado === "anonimo") await cargarCuentaDeLaSesion(); }
  return r;
}

// ---------- invitaciones: «Invita y consigue la app gratis» ----------
/** Datos de la tarjeta de invitar: { codigo, necesarios, invitados, pagados, gratis, usado, puede_usar }, o null si falla. */
export async function misReferidos() {
  try {
    const r = await api("/rest/v1/rpc/mi_referidos", { metodo: "POST", cuerpo: {} });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
export const ERRORES_CODIGO = {
  no_existe: "Ese código no existe. Revísalo.",
  propio: "No puedes usar tu propio código.",
  ya_usado: "Ya has usado un código de invitación.",
  circular: "Esa persona se registró con tu código, así que no puede contar.",
  caducado: "El código solo se puede usar durante los primeros 30 días de tu cuenta.",
};
/** Aplica el código de quien te invitó. Devuelve el mensaje para enseñar: { ok, mensaje }. */
export async function usarCodigo(codigo) {
  try {
    const r = await api("/rest/v1/rpc/usar_codigo", { metodo: "POST", cuerpo: { p_codigo: (codigo || "").trim() } });
    if (!r.ok) return { ok: false, mensaje: "No se pudo aplicar el código. Inténtalo de nuevo." };
    const res = await r.json();
    if (res === "ok") { olvidarCodigo(); return { ok: true, mensaje: "¡Código aplicado! Gracias." }; }
    return { ok: false, mensaje: ERRORES_CODIGO[res] || "No se pudo aplicar el código." };
  } catch (e) { return { ok: false, mensaje: "No se pudo aplicar el código. Comprueba la conexión." }; }
}
/** Mensaje y enlaces para compartir el código por WhatsApp, Telegram, etc. */
export function enlacesInvitar(codigo) {
  const base = (cfg.urlWeb || location.origin + location.pathname.replace(/index\.html$/, "")).replace(/\/?$/, "/");
  const enlace = `${base}?ref=${encodeURIComponent(codigo)}`;
  const texto = `Estoy usando Docentes Aragón para seguir las adjudicaciones de interinos de Aragón. Entra en ${enlace}, crea tu cuenta (${cfg.diasPrueba || 15} días de prueba gratis) y, si no se rellena solo, pon mi código de invitación: ${codigo}`;
  return { enlace, texto, wa: "https://wa.me/?text=" + encodeURIComponent(texto),
    tg: "https://t.me/share/url?url=" + encodeURIComponent(enlace) + "&text=" + encodeURIComponent(texto.replace(enlace, "").replace(/\s+/g, " ").trim()) };
}

export function entrarConGoogle() {
  const vuelta = location.origin + location.pathname;
  location.href = `${URL_SB}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(vuelta)}`;
}

function vaciarDatosPersonales() {
  YO.listas = []; YO.destinos = []; YO.favoritos = []; CUENTA.pase = null; CUENTA.ultimoPase = null; CUENTA.sync = "";
  CUENTA.perfil = null; CUENTA.admin = false; CUENTA.verComo = null; copiaYo = null;
}
export async function salir() {
  const token = sesion?.access_token;
  fijarSesion(null); vaciarDatosPersonales(); CUENTA.recuperando = false; actualizarEstado();
  if (token) { try { await fetch(`${URL_SB}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + token } }); } catch (e) { /* da igual */ } }
}
/** Borra el pase, la prueba, el código de invitación, el nombre, el municipio, los dispositivos con avisos, los mensajes y el seguimiento (con sus favoritos) de Docentes Aragón (la cuenta, con su correo y contraseña, es compartida con otras webs y no se toca) y cierra la sesión. */
export async function borrarMisDatos() {
  const r = await api("/rest/v1/rpc/borrar_mis_datos", { metodo: "POST", cuerpo: {} });
  if (!r.ok) throw new Error("No se pudieron borrar tus datos. Inténtalo de nuevo.");
  await salir();
}
/** Tras una compra: vuelve a mirar el pase y carga el seguimiento. */
export async function pagoHecho() {
  await cargarPase();
  if (CUENTA.estado === "con_pase") await cargarSeguimiento();
}
/** Guardar ya (por ejemplo antes de cerrar sesión). */
export const guardarAhora = () => (CUENTA.estado === "con_pase" ? subir() : Promise.resolve(false));
export const URL_FUNCIONES = `${URL_SB}/functions/v1`;
export const CLAVE_ANON = cfg.supabaseAnonKey;
