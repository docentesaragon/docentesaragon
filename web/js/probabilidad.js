// Probabilidad de conseguir plaza (estimación) para cada lista de «Mi seguimiento».
// Cada semana se adjudica hasta un «último llamado». Si tu posición está antes o igual que ese último llamado, esa semana te habría tocado
// (si estabas disponible). Contamos con qué frecuencia ha pasado, dando más peso a las últimas semanas, y de ahí sale la probabilidad de que
// pase en alguna de las próximas semanas. Solo usa datos públicos ya cargados en la web: no necesita cuenta ni servidor.
import { h, s, miles, fmtDMA } from "./util.js";
import { D } from "./datos.js";
import { situacion } from "./comun.js";

export const SEMANAS_PREVISION = 3;
const OLVIDO = 0.85;            // cada semana más antigua pesa un 15 % menos
const PRIOR = [0.2, 0.4];       // «0,2 aciertos en 0,4 semanas» imaginarias: evita 0 % y 100 % con pocas semanas

/** Semanas del curso con lista para esa especialidad, de más antigua a más reciente. */
export function semanasDeLista(cuerpoCod, esp, clave) {
  const cuerpo = cuerpoCod === "0597" ? "maestros" : "secundaria";
  return D.actos.filter((a) => a.curso === D.curso && a.cuerpo === cuerpo)
    .sort((a, b) => (a.fecha_oferta < b.fecha_oferta ? -1 : 1))
    .map((a) => {
      const u = (D.ultimoPorActo.get(a.acto) || []).find((x) => x.cuerpo_cod === cuerpoCod && x.esp === esp);
      return u && (u.convocados || u.clave_ultimo) ? { acto: a.acto, fecha: a.fecha_oferta, vacantes: u.vacantes || 0, adjudicadas: u.adjudicadas || 0, sit: situacion(clave, u) } : null;
    }).filter(Boolean);
}

/** Plazas ordinarias ofrecidas por semana (no depende de tu posición). */
export function resumenPlazas(semanas) {
  const con = semanas.filter((x) => x.vacantes > 0);
  const total = con.reduce((n, x) => n + x.vacantes, 0);
  return { total, semanas: con.length, media: con.length ? total / con.length : 0, ultimas3: semanas.slice(-3).reduce((n, x) => n + x.vacantes, 0), hayDatos: con.length > 0 };
}

/** Estimación a partir de las semanas: { prob, porSemana, llegoEn, de, pocosDatos } o null si no hay semanas. */
export function estimar(semanas) {
  const util = semanas.filter((w) => w.sit.cod !== "sin-dato");
  if (!util.length) return null;
  let aciertos = PRIOR[0], pesos = PRIOR[1];
  util.forEach((w, i) => {
    const peso = OLVIDO ** (util.length - 1 - i);
    pesos += peso;
    if (w.sit.cod === "alcanzada") aciertos += peso;
  });
  const porSemana = aciertos / pesos;
  return {
    porSemana, prob: 1 - (1 - porSemana) ** SEMANAS_PREVISION,
    llegoEn: util.filter((w) => w.sit.cod === "alcanzada").length, de: util.length,
    cerca: util.filter((w) => w.sit.cod === "convocado").length,
    pocosDatos: util.length < 4,
  };
}

export function nivel(prob) {
  return prob >= 0.66 ? ["Alta", "alta"] : prob >= 0.33 ? ["Media", "media"] : ["Baja", "baja"];
}
export function textoPorcentaje(prob) {
  const p = prob * 100;
  return p >= 99.5 ? "más del 99 %" : p < 1 ? "menos del 1 %" : `${Math.round(p)} %`;
}

/** Barras: plazas ofrecidas cada semana; verde = la adjudicación llegó a tu posición, naranja = estabas convocada pero no llegó, gris = el resto. */
function grafico(semanas) {
  const ult = semanas.slice(-16);
  const W = 560, H = 150, mi = 30, md = 8, ms = 12, mb = 26;
  const max = Math.max(1, ...ult.map((w) => w.vacantes));
  const ancho = (W - mi - md) / ult.length, b = Math.max(4, Math.min(26, ancho * 0.7));
  const color = (c) => (c === "alcanzada" ? "var(--verde, #1a7f3c)" : c === "convocado" ? "var(--oro, #e8a800)" : "currentColor");
  const alto = (v) => ((H - ms - mb) * v) / max;
  return s("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico-prob", role: "img",
    "aria-label": `Plazas ofrecidas cada semana en tu especialidad (de ${fmtDMA(ult[0].fecha)} a ${fmtDMA(ult[ult.length - 1].fecha)}); en ${ult.filter((w) => w.sit.cod === "alcanzada").length} de ${ult.length} la adjudicación llegó a tu posición` },
    s("line", { x1: mi, y1: H - mb, x2: W - md, y2: H - mb, stroke: "currentColor", "stroke-opacity": ".25" }),
    s("text", { x: mi - 4, y: ms + 8, "text-anchor": "end" }, miles(max)),
    s("text", { x: mi - 4, y: H - mb, "text-anchor": "end" }, "0"),
    ...ult.map((w, i) => s("rect", { x: mi + i * ancho + (ancho - b) / 2, y: H - mb - alto(w.vacantes), width: b, height: Math.max(1.5, alto(w.vacantes)), rx: 2,
      fill: color(w.sit.cod), "fill-opacity": w.sit.cod === "alcanzada" || w.sit.cod === "convocado" ? 0.9 : 0.3 })),
    s("text", { x: mi, y: H - 6 }, fmtDMA(ult[0].fecha).slice(0, 5)),
    s("text", { x: W - md, y: H - 6, "text-anchor": "end" }, fmtDMA(ult[ult.length - 1].fecha).slice(0, 5)));
}

/** Tarjeta de una lista. `l` = { cuerpo_cod, esp, clave }. */
export function tarjetaProbabilidad(l) {
  const semanas = semanasDeLista(l.cuerpo_cod, l.esp, l.clave);
  const est = estimar(semanas), pl = resumenPlazas(semanas);
  if (!est) return h("div", { class: "prob", id: `prob-${l.cuerpo_cod}-${l.esp}` }, h("h4", null, "Probabilidad de conseguir plaza"),
    h("p", { class: "tenue", id: "prob-sin" }, "Todavía no hay semanas con lista de esta especialidad en este curso para estimarlo."));
  const [texto, cls] = nivel(est.prob);
  const ultima = semanas[semanas.length - 1];
  return h("div", { class: "prob", id: `prob-${l.cuerpo_cod}-${l.esp}` },
    h("h4", null, "Probabilidad de conseguir plaza ", h("span", { class: "tenue peq" }, "(estimación)")),
    h("div", { class: "prob-caja " + cls, role: "group", "aria-label": `Probabilidad ${texto.toLowerCase()}` },
      h("p", { class: "prob-nivel", id: "prob-nivel" }, h("strong", null, texto), " · ", textoPorcentaje(est.prob)),
      h("div", { class: "prob-barra", "aria-hidden": "true" }, h("span", { style: `--p:${Math.max(1, Math.min(100, Math.round(est.prob * 100)))}%` })),
      h("p", { class: "tenue peq", style: "margin:.3rem 0 0" }, `En las ${SEMANAS_PREVISION} próximas semanas, si todo sigue como en las últimas.`)),
    h("div", { class: "prob-datos" },
      h("div", null, h("span", { class: "tenue peq" }, "La adjudicación llegó a tu posición"), h("strong", { class: "num", id: "prob-llego" }, `${miles(est.llegoEn)} de ${miles(est.de)} semanas`)),
      h("div", null, h("span", { class: "tenue peq" }, "Plazas ofrecidas por semana"), h("strong", { class: "num" }, pl.hayDatos ? `${pl.media.toFixed(1).replace(".", ",")} de media` : "—")),
      h("div", null, h("span", { class: "tenue peq" }, "Última semana"), h("strong", { class: "prob-ultima" }, ultima.sit.cod === "alcanzada" ? "Te llegó" : ultima.sit.cod === "convocado" ? "Cerca" : "No llegó")))
    ,
    pl.hayDatos ? h("p", { class: "tenue peq prob-plazas" }, `Tu especialidad ha ofrecido ${miles(pl.total)} plazas ordinarias en ${miles(pl.semanas)} semanas (${miles(pl.ultimas3)} en las últimas 3).`) : null,
    semanas.length > 1 ? h("div", null,
      h("p", { class: "tenue peq", style: "margin:.6rem 0 0" }, "Plazas ofrecidas cada semana: ", h("span", { class: "leyenda-verde" }, "verde"), " = la adjudicación llegó a tu posición; ", h("span", { class: "leyenda-oro" }, "naranja"), " = estabas entre los convocados pero no llegó."),
      grafico(semanas)) : null,
    est.pocosDatos ? h("p", { class: "tenue peq" }, "Todavía hay pocas semanas con datos: la estimación irá afinándose.") : null,
    h("p", { class: "tenue peq" }, "Estimación orientativa: mira con qué frecuencia la adjudicación semanal ha llegado a tu posición (más peso a las últimas semanas). No sabe si estás disponible ni qué plazas pedirás, y el pasado no garantiza lo que pase. Aragón no publica las peticiones, así que no se puede contar quién compite contigo."));
}
