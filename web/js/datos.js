// Carga de datos: desde Supabase si js/config.js tiene URL y clave; si no (o si falla), desde /data.
import { leerLocal, guardarLocal, esMaestros } from "./util.js";

const cfg = window.CONFIG || {};
const USA_SB = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
export const ESQUEMA = cfg.supabaseSchema || "aragon";       // esquema de Postgres con nuestras tablas (supabase/schema.sql)
/** Con Supabase configurado, "Mi seguimiento" es el área personal de pago (cuenta + pase). Sin él, modo de prueba local. */
export const MODO_CUENTA = USA_SB && cfg.zonaPago !== false;
const ORDEN = {
  actos: "acto", cuerpos: "cod", especialidades: "cuerpo_cod,cod", localidades: "localidad,provincia",
  ultimo_llamado: "acto,cuerpo_cod,esp", vacantes: "id",
};

export const D = {
  modo: USA_SB ? "supabase" : "estatico",
  aviso: null,
  actos: [], cuerpos: {}, esp: {}, locs: {}, ultimo: [], vacantes: [],
  cursos: [], curso: null, generado: null,
  actoPorId: new Map(), ultimoPorActo: new Map(),
};

async function sb(tabla, filtro = "") {
  const filas = [];
  for (let off = 0; ; off += 1000) {
    const url = `${cfg.supabaseUrl.replace(/\/$/, "")}/rest/v1/${tabla}?select=*${filtro}&order=${ORDEN[tabla]}&limit=1000&offset=${off}`;
    const r = await fetch(url, { headers: { apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + cfg.supabaseAnonKey, "Accept-Profile": ESQUEMA } });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status} en ${tabla}`);
    const lote = await r.json();
    filas.push(...lote);
    if (lote.length < 1000) return filas;
  }
}
async function estatico(nombre) {
  const r = await fetch(`data/${nombre}.json`);
  if (!r.ok) throw new Error(`No se encuentra data/${nombre}.json`);
  return r.json();
}
async function leer(tabla, filtro) {
  if (D.modo === "supabase") return sb(tabla, filtro);
  return estatico(tabla);
}

export async function cargarBase() {
  let datos;
  try {
    datos = await Promise.all(["actos", "cuerpos", "especialidades", "localidades", "ultimo_llamado"].map((t) => leer(t)));
  } catch (e) {
    if (D.modo !== "supabase") throw e;
    console.warn("Supabase no responde; uso la instantánea de /data.", e);
    D.modo = "estatico";
    D.aviso = "No se pudo conectar con la base de datos. Estás viendo la última copia guardada en la web, que puede no estar al día.";
    datos = await Promise.all(["actos", "cuerpos", "especialidades", "localidades", "ultimo_llamado"].map((t) => leer(t)));
  }
  const [actos, cuerpos, esp, locs, ultimo] = datos;
  D.actos = actos.sort((a, b) => (a.fecha_oferta < b.fecha_oferta ? 1 : a.fecha_oferta > b.fecha_oferta ? -1 : a.acto < b.acto ? 1 : -1));
  D.cuerpos = Object.fromEntries(cuerpos.map((c) => [c.cod, c.nombre]));
  D.esp = Object.fromEntries(esp.map((e) => [`${e.cuerpo_cod}|${e.cod}`, e.nombre]));
  D.locs = Object.fromEntries(locs.map((l) => [l.localidad, l]));
  D.ultimo = ultimo;
  D.actoPorId = new Map(D.actos.map((a) => [a.acto, a]));
  D.ultimoPorActo = new Map();
  for (const u of ultimo) {
    if (!D.ultimoPorActo.has(u.acto)) D.ultimoPorActo.set(u.acto, []);
    D.ultimoPorActo.get(u.acto).push(u);
  }
  D.cursos = [...new Set(D.actos.map((a) => a.curso))].sort().reverse();
  if (D.modo === "estatico") {
    try { D.generado = (await estatico("meta")).generado; } catch (e) { /* opcional */ }
  }
  D.generado = D.generado || D.actos[0]?.fecha_oferta;
}

const cacheVac = new Map();
export async function cargarVacantes(curso) {
  if (!cacheVac.has(curso)) {
    const filas = D.modo === "supabase" ? await sb("vacantes", `&curso=eq.${encodeURIComponent(curso)}`) : await estatico(`vacantes_${curso}`);
    for (const v of filas) v.fecha_adj = D.actoPorId.get(v.acto)?.fecha_adjudicacion || D.actoPorId.get(v.acto)?.fecha_oferta;
    cacheVac.set(curso, filas);
  }
  D.vacantes = cacheVac.get(curso);
  D.curso = curso;
  return D.vacantes;
}

// ---------- consultas útiles ----------
export const actosDe = (curso, cuerpo) =>
  D.actos.filter((a) => a.curso === curso && (!cuerpo || a.cuerpo === cuerpo));
export const nombreEsp = (cuerpoCod, cod) => D.esp[`${cuerpoCod}|${cod}`] || cod;
export const nombreCuerpo = (cod) => D.cuerpos[cod] || cod;
export const cuerpoDeCod = (cod) => (esMaestros(cod) ? "maestros" : "secundaria");

// ---------- datos personales ----------
// Modo de prueba (sin Supabase): todo se guarda en este navegador.
// Modo cuenta: listas, destinos y centros favoritos viven en la cuenta (js/cuenta.js); en el navegador solo queda una preferencia sin datos personales (maestros/secundaria).
const CLAVE_YO = "docentes-aragon:v1";
const CLAVE_PREF = "docentes-aragon:pref";
export const YO = MODO_CUENTA
  ? { listas: [], destinos: [], favoritos: [], cuerpo: leerLocal(CLAVE_PREF, {}).cuerpo || "maestros" }
  : leerLocal(CLAVE_YO, { listas: [], destinos: [], favoritos: [], cuerpo: "maestros" });
YO.listas ||= []; YO.destinos ||= []; YO.favoritos ||= []; YO.cuerpo ||= "maestros";
export const enlace = { alGuardar: null };                    // cuenta.js lo rellena para sincronizar
export function guardarYo() {
  if (!MODO_CUENTA) { guardarLocal(CLAVE_YO, YO); return; }
  guardarLocal(CLAVE_PREF, { cuerpo: YO.cuerpo });
  enlace.alGuardar?.();
}
/** Datos de una versión anterior, guardados en este navegador (para importarlos a la cuenta una vez). */
export const CLAVE_ANTIGUA = CLAVE_YO;
