// Piezas que comparten varias secciones.
import { h, fmtCorta, fmtLarga, miles, textoClave, bonito } from "./util.js";
import { D, YO, nombreEsp } from "./datos.js";

/** La "regla": barra roja hasta la posición del último llamado dentro de los convocados. */
export function regla(relacion, total) {
  if (!relacion || !total) return h("div", { class: "regla sin-dato", role: "img", "aria-label": "Sin datos de la lista" });
  const p = Math.max(0.5, Math.min(100, (relacion / total) * 100));
  return h("div", { class: "regla", role: "img", "aria-label": `La lista llegó al número ${relacion} de ${total} convocados` },
    h("span", { class: "regla-llena", style: `--p:${p.toFixed(2)}%` }));
}

export function segmento(opciones, valor, alCambiar, etiqueta) {
  const caja = h("div", { class: "segmento", role: "group", "aria-label": etiqueta });
  for (const [v, texto] of opciones) {
    caja.append(h("button", {
      type: "button", "aria-pressed": String(v === valor),
      onclick: () => alCambiar(v),
    }, texto));
  }
  return caja;
}

export function campoSelect(etiqueta, opciones, valor, alCambiar, id) {
  const sel = h("select", { id, onchange: (e) => alCambiar(e.target.value) },
    opciones.map(([v, t]) => h("option", { value: v, selected: v === valor }, t)));
  return h("label", null, etiqueta, sel);
}

export function etiquetaActo(a) {
  return `${fmtCorta(a.fecha_oferta)} (${a.acto})`;
}

/** Dónde queda la persona respecto a una fila de ultimo_llamado. */
export function situacion(clave, u) {
  if (!clave || !u || (!u.clave_max_convocado && !u.clave_ultimo)) return { cod: "sin-dato", texto: "Sin datos de la lista esta semana" };
  if (u.clave_ultimo && clave <= u.clave_ultimo) return { cod: "alcanzada", texto: "La lista llegó a tu posición" };
  if (!u.clave_max_convocado) return { cod: "no-llego", texto: "La lista no llegó a tu posición" };
  if (clave <= u.clave_max_convocado) return { cod: "convocado", texto: "Estabas entre los convocados, pero la lista no llegó a ti" };
  return { cod: "lejos", texto: "Todavía fuera de los convocados" };
}

export const misListas = () => YO.listas.filter((l) => l.clave);

export function nombreEspBonito(cuerpoCod, cod) { return bonito(nombreEsp(cuerpoCod, cod)); }

export function fraseActo(a) {
  if (!a) return "";
  const ord = (a.n_adjudicadas || 0) - (a.n_singulares_adjudicadas || 0);
  const oferta = a.n_ofertadas ? `Se ofrecieron ${miles(a.n_ofertadas)} vacantes ordinarias` : "";
  if (!a.tiene_adjudicadas) return `${oferta || "Oferta publicada"}. La adjudicación aún no está publicada.`;
  const sing = a.n_singulares_adjudicadas ? `, más ${miles(a.n_singulares_adjudicadas)} singularizadas` : "";
  const sin = Math.max(0, (a.n_ofertadas || 0) - ord);
  const sinTxt = sin ? ` ${sin === 1 ? "Quedó 1 sin adjudicar" : `Quedaron ${miles(sin)} sin adjudicar`}.` : "";
  return `${oferta ? oferta + " y se" : "Se"} adjudicaron ${miles(ord)}${sing}.${sinTxt}`;
}

export function cabeceraActo(a) {
  if (!a) return h("p", { class: "vacio" }, "No hay semanas cargadas para este curso.");
  return h("div", { class: "cabecera-vista" },
    h("h2", null, a.fecha_adjudicacion ? `Adjudicación del ${fmtLarga(a.fecha_adjudicacion)}` : `Oferta del ${fmtLarga(a.fecha_oferta)}`),
    h("p", { class: "tenue peq" }, `Acto ${a.acto}. Oferta publicada el ${fmtLarga(a.fecha_oferta)}.`),
    h("p", { class: "resumen-frase" }, fraseActo(a)));
}

export { D };
