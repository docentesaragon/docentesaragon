// Sección "Histórico": evolución semana a semana del último llamado en una especialidad.
import { h, llenar, s, fmtCorta, fmtDMA, miles, textoClave } from "./util.js";
import { D, YO, guardarYo, actosDe, nombreCuerpo } from "./datos.js";
import { segmento, situacion, nombreEspBonito, misListas } from "./comun.js";

const estado = { clave: null };

export function historico(raiz, params = {}) {
  if (params.cuerpo) { YO.cuerpo = params.cuerpo; guardarYo(); }
  const cuerpo = YO.cuerpo;
  const actos = actosDe(D.curso, cuerpo).filter((a) => a.tiene_candidatos || a.tiene_adjudicadas).sort((a, b) => (a.fecha_oferta < b.fecha_oferta ? -1 : 1));
  const ids = new Set(actos.map((a) => a.acto));
  const filas = D.ultimo.filter((u) => ids.has(u.acto) && (u.convocados || u.clave_ultimo));
  const semanas = new Map();            // "cuerpo|esp" -> filas
  for (const u of filas) {
    const k = `${u.cuerpo_cod}|${u.esp}`;
    if (!semanas.has(k)) semanas.set(k, []);
    semanas.get(k).push(u);
  }
  const opciones = [...semanas.keys()].sort((a, b) => nombreEspBonito(...a.split("|")).localeCompare(nombreEspBonito(...b.split("|")), "es"));
  if (params.esp && semanas.has(params.esp)) estado.clave = params.esp;
  if (!semanas.has(estado.clave)) {
    const mia = misListas().map((l) => `${l.cuerpo_cod}|${l.esp}`).find((k) => semanas.has(k));
    estado.clave = mia || opciones[0];
  }

  const sel = h("select", { id: "sel-esp", onchange: (e) => { estado.clave = e.target.value; historico(raiz); } },
    opciones.map((k) => {
      const [c, e] = k.split("|");
      return h("option", { value: k, selected: k === estado.clave }, `${e}: ${nombreEspBonito(c, e)} (${semanas.get(k).length} sem.)`);
    }));
  llenar(raiz, 
    h("div", { class: "cabecera-vista" }, h("h2", null, "Histórico por especialidad"),
      h("p", { class: "tenue" }, "Cómo se ha ido moviendo el último llamado a lo largo del curso. Las semanas sin listado de candidatos publicado se calculan con las listas de otras semanas y se marcan como tales.")),
    h("div", { class: "filtros" },
      h("div", null, h("div", { class: "tenue peq", style: "margin-bottom:.2rem" }, "Cuerpo"),
        segmento([["maestros", "Maestros"], ["secundaria", "Secundaria y otros"]], cuerpo, (v) => { YO.cuerpo = v; guardarYo(); estado.clave = null; historico(raiz); }, "Cuerpo")),
      h("label", null, "Especialidad", sel)));
  if (!estado.clave) { raiz.append(h("p", { class: "vacio" }, "Todavía no hay semanas con listas para este cuerpo y curso.")); return; }

  const [cod, esp] = estado.clave.split("|");
  const serie = semanas.get(estado.clave)
    .map((u) => ({ u, a: D.actoPorId.get(u.acto) }))
    .sort((x, y) => (x.a.fecha_oferta < y.a.fecha_oferta ? -1 : 1));
  const mia = misListas().find((l) => l.cuerpo_cod === cod && l.esp === esp);
  raiz.append(grafico(serie, mia), tabla(serie, mia));
}

function grafico(serie, mia) {
  const claves = new Set();
  for (const { u } of serie) { if (u.clave_ultimo) claves.add(u.clave_ultimo); if (u.clave_max_convocado) claves.add(u.clave_max_convocado); }
  if (mia) claves.add(mia.clave);
  const orden = [...claves].sort();
  const rango = (k) => (orden.length > 1 ? orden.indexOf(k) / (orden.length - 1) : 0.5);
  const W = 760, H = 300, mi = 24, md = 24, ms = 14, mb = 42;
  const x0 = mi + 16;
  const x = (i) => (serie.length > 1 ? x0 + (i * (W - x0 - md)) / (serie.length - 1) : (x0 + W - md) / 2);
  const y = (k) => H - mb - rango(k) * (H - mb - ms);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Gráfico del último llamado por semana; los mismos datos están en la tabla de debajo." });
  svg.append(s("line", { x1: mi, y1: ms, x2: mi, y2: H - mb, stroke: "var(--linea)" }), s("line", { x1: mi, y1: H - mb, x2: W - md, y2: H - mb, stroke: "var(--linea)" }));
  const cada = Math.ceil(serie.length / 12);
  serie.forEach(({ a }, i) => {
    if (i % cada === 0 || i === serie.length - 1) svg.append(s("text", { x: x(i), y: H - mb + 18, "text-anchor": "middle" }, fmtCorta(a.fecha_oferta)));
  });
  if (mia) {
    const yy = y(mia.clave);
    svg.append(s("line", { x1: mi, x2: W - md, y1: yy, y2: yy, stroke: "var(--oro)", "stroke-width": 3, "stroke-dasharray": "7 5" }),
      s("text", { x: W - md, y: yy - 6, "text-anchor": "end", style: "fill:var(--tinta);font-weight:700" }, "Tu posición"));
  }
  // último convocado (gris, hueco) y último llamado (rojo, lleno)
  const lineaPuntos = (campo) => serie.map((p, i) => (p.u[campo] ? `${x(i).toFixed(1)},${y(p.u[campo]).toFixed(1)}` : null));
  const trazo = (pts, estilo) => {
    let tramo = [];
    const fuera = [];
    for (const p of pts.concat([null])) { if (p) tramo.push(p); else { if (tramo.length > 1) fuera.push(tramo.join(" ")); tramo = []; } }
    return fuera.map((d) => s("polyline", { points: d, fill: "none", ...estilo }));
  };
  svg.append(...trazo(lineaPuntos("clave_max_convocado"), { stroke: "var(--tinta-2)", "stroke-width": 1.5, "stroke-dasharray": "2 4" }));
  svg.append(...trazo(lineaPuntos("clave_ultimo"), { stroke: "var(--rojo)", "stroke-width": 2.5 }));
  serie.forEach(({ u, a }, i) => {
    if (u.clave_max_convocado) svg.append(s("rect", { x: x(i) - 4, y: y(u.clave_max_convocado) - 4, width: 8, height: 8, fill: "var(--panel)", stroke: "var(--tinta-2)", "stroke-width": 1.5 },
      s("title", null, `${fmtDMA(a.fecha_oferta)}: último convocado, ${textoClave(u.clave_max_convocado)}`)));
    if (u.clave_ultimo) svg.append(s("circle", { cx: x(i), cy: y(u.clave_ultimo), r: 5, fill: "var(--rojo)", stroke: "var(--panel)", "stroke-width": 1.5 },
      s("title", null, `${fmtDMA(a.fecha_oferta)}: último llamado, ${u.relacion_ultimo ? `n.º ${u.relacion_ultimo} de ${u.convocados}; ` : ""}${textoClave(u.clave_ultimo)}${u.reconstruido ? " (calculado con otras semanas)" : ""}`)));
  });
  return h("div", { class: "grafico" }, svg,
    h("div", { class: "leyenda" },
      h("span", null, h("i", { style: "background:var(--rojo);border-radius:50%;width:.8em" }), "Último llamado"),
      h("span", null, h("i", { style: "border:1.5px solid var(--tinta-2);width:.8em" }), "Último convocado"),
      mia ? h("span", null, h("i", { style: "border-top:3px dashed var(--oro);height:0" }), "Tu posición") : null,
      h("span", null, "Más arriba = más al fondo de la lista. La altura indica orden, no distancia.")));
}

function tabla(serie, mia) {
  const cab = ["Oferta", "Plazas", "Convocados", "Último llamado", "Posición del último llamado"];
  if (mia) cab.push("Tu situación");
  const cuerpo = serie.slice().reverse().map(({ u, a }) => {
    const sit = mia ? situacion(mia.clave, u) : null;
    return h("tr", null,
      h("td", null, fmtDMA(a.fecha_oferta)),
      h("td", { class: "num" }, u.vacantes ? `${miles(u.adjudicadas)} de ${miles(u.vacantes)}` : miles(u.adjudicadas)),
      h("td", { class: "num" }, u.convocados ? miles(u.convocados) : "—"),
      h("td", { class: "num" }, u.relacion_ultimo ? `n.º ${miles(u.relacion_ultimo)}` : "—"),
      h("td", null, u.clave_ultimo ? textoClave(u.clave_ultimo) : "—", u.reconstruido ? h("div", { class: "peq tenue" }, "Calculado con listas de otras semanas") : null),
      sit ? h("td", null, sit.texto) : null);
  });
  return h("div", { class: "tabla-wrap" }, h("table", { class: "datos" },
    h("thead", null, h("tr", null, cab.map((c, i) => h("th", { class: i >= 1 && i <= 3 ? "num" : "" }, c)))),
    h("tbody", null, cuerpo)));
}
