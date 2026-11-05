// Utilidades pequeñas: crear elementos sin innerHTML, formatos en español, claves de la lista.

export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  poner(el, attrs, hijos);
  return el;
}
/** Como replaceChildren, pero admite listas anidadas y descarta null/false (que si no saldrían escritos como "null"). */
export function llenar(el, ...hijos) {
  el.replaceChildren(...hijos.flat(Infinity).filter((c) => c != null && c !== false));
}
const NS_SVG = "http://www.w3.org/2000/svg";
export function s(tag, attrs, ...hijos) {
  const el = document.createElementNS(NS_SVG, tag);
  poner(el, attrs, hijos);
  return el;
}
function poner(el, attrs, hijos) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function fecha(iso) { return iso ? new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : null; }
export function fmtCorta(iso) { return iso ? `${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1]}` : "—"; }
export function fmtDMA(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—"; }
export function fmtLarga(iso) {
  const d = fecha(iso);
  return d ? `${DIAS[d.getDay()]} ${d.getDate()} de ${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][d.getMonth()]}` : "—";
}
export const miles = (n) => (n == null ? "—" : Number(n).toLocaleString("es-ES"));

/** 'L-AAAAMMDD-BBB-OOOOO' -> partes. */
export function parseClave(k) {
  if (!k) return null;
  const m = /^(\d)-(\d{4})(\d\d)(\d\d)-(\d+)-(\d+)$/.exec(k);
  if (!m) return null;
  return { lista: +m[1], fecha: `${m[2]}-${m[3]}-${m[4]}`, bloque: +m[5], orden: +m[6] };
}
export function claveDe({ lista, fecha: f, bloque, orden }) {
  if (!lista || !f || !bloque || !orden) return null;
  return `${+lista}-${f.replace(/-/g, "")}-${String(+bloque).padStart(3, "0")}-${String(+orden).padStart(5, "0")}`;
}
/** Texto legible de una clave: "lista 1, bloque 32, orden 12 (22/07/2026)". */
export function textoClave(k) {
  const p = parseClave(k);
  return p ? `lista ${p.lista}, bloque ${p.bloque}, orden ${p.orden} (${fmtDMA(p.fecha)})` : "—";
}

export function esMaestros(cuerpoCod) { return cuerpoCod === "0597"; }

export function norm(t) { return (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

const MENORES = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "al"]);
/** "MARIA DE HUERVA" -> "Maria de Huerva". */
export function bonito(t) {
  if (!t) return "";
  return t.toLowerCase().split(/(\s+|-)/).map((w, i) => (i > 0 && MENORES.has(w)) ? w : w.replace(/^\(?\p{L}/u, (c) => c.toUpperCase())).join("");
}
/** "ALMUNIA DE DOÑA GODINA (LA)" -> "La Almunia de Doña Godina". */
export function localidadBonita(t) {
  if (!t) return "";
  const m = /^(.*)\s\((LA|EL|LAS|LOS)\)$/.exec(t);
  return bonito(m ? `${m[2]} ${m[1]}` : t);
}
/** "CEIP MARÍA MOLINER" -> "CEIP María Moliner" (las siglas del principio se quedan en mayúsculas). */
export function centroBonito(t) {
  if (!t) return "";
  const p = t.split(/\s+/);
  let i = 0;
  if (p.length > 1 && /^[A-ZÁÉÍÓÚÑ]{2,6}$/.test(p[0])) i = 1;
  return [...p.slice(0, i), bonito(p.slice(i).join(" "))].filter(Boolean).join(" ");
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function csv(filas, cols) {
  const esc = (v) => { v = v == null ? "" : String(v); return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return "﻿" + [cols.map((c) => esc(c[0])).join(";")].concat(filas.map((f) => cols.map((c) => esc(c[1](f))).join(";"))).join("\r\n");
}
export function descargar(nombre, texto, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = h("a", { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function guardarLocal(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* navegación privada */ } }
export function leerLocal(clave, defecto) { try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : defecto; } catch (e) { return defecto; } }
