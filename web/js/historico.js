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
  const W = 760, H = 340, ml = 18, mr = 22, mt = 24, mb = 44;
  const x = (i) => (serie.length > 1 ? ml + (i * (W - ml - mr)) / (serie.length - 1) : (ml + W - mr) / 2);
  const y = (k) => H - mb - 12 - rango(k) * (H - mb - mt - 24);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Gráfico del último llamado por semana; los mismos datos están en la tabla de debajo." });
  svg.append(s("defs", null, s("linearGradient", { id: "rellenoUltimo", x1: 0, y1: 0, x2: 0, y2: 1 },
    s("stop", { offset: "0%", "stop-color": "var(--rojo)", "stop-opacity": 0.28 }), s("stop", { offset: "100%", "stop-color": "var(--rojo)", "stop-opacity": 0.02 }))));
  // rejilla suave y rótulos del eje vertical
  for (let g = 0; g <= 3; g++) {
    const yy = mt + 12 + (g * (H - mb - mt - 24)) / 3;
    svg.append(s("line", { x1: ml, x2: W - mr, y1: yy, y2: yy, class: "rejilla" }));
  }
  svg.append(s("text", { x: ml, y: 12, class: "eje-nota" }, "↑ más al fondo de la lista"), s("text", { x: ml, y: H - mb + 32, class: "eje-nota", style: "display:none" }, ""));
  svg.append(s("line", { x1: ml, y1: H - mb, x2: W - mr, y2: H - mb, stroke: "var(--linea)" }));
  const cada = Math.ceil(serie.length / 10);
  serie.forEach(({ a }, i) => {
    if (i % cada === 0 || i === serie.length - 1) svg.append(s("text", { x: x(i), y: H - mb + 20, "text-anchor": "middle" }, fmtCorta(a.fecha_oferta)));
  });
  if (mia) {
    const yy = y(mia.clave);
    svg.append(s("line", { x1: ml, x2: W - mr, y1: yy, y2: yy, stroke: "var(--oro)", "stroke-width": 3, "stroke-dasharray": "7 5" }),
      s("text", { x: W - mr, y: yy - 7, "text-anchor": "end", style: "fill:var(--tinta);font-weight:700" }, "Tu posición"));
  }
  const tramos = (campo) => {
    const res = []; let t = [];
    serie.forEach((p, i) => { const k = p.u[campo]; if (k) t.push([x(i), y(k)]); else { if (t.length) res.push(t); t = []; } });
    if (t.length) res.push(t);
    return res;
  };
  const pts = (t) => t.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  // área bajo el último llamado
  for (const t of tramos("clave_ultimo")) if (t.length > 1)
    svg.append(s("polygon", { points: `${t[0][0].toFixed(1)},${H - mb} ${pts(t)} ${t[t.length - 1][0].toFixed(1)},${H - mb}`, fill: "url(#rellenoUltimo)" }));
  for (const t of tramos("clave_max_convocado")) if (t.length > 1)
    svg.append(s("polyline", { points: pts(t), fill: "none", stroke: "var(--tinta-2)", "stroke-width": 1.5, "stroke-dasharray": "2 4", "stroke-linejoin": "round" }));
  for (const t of tramos("clave_ultimo")) if (t.length > 1)
    svg.append(s("polyline", { points: pts(t), fill: "none", stroke: "var(--rojo)", "stroke-width": 2.75, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  const guia = s("line", { y1: mt - 6, y2: H - mb, class: "guia", style: "display:none" });
  svg.append(guia);
  const puntos = serie.map(({ u }, i) => {
    const g = s("g", { class: "punto" });
    if (u.clave_max_convocado) g.append(s("rect", { x: x(i) - 4, y: y(u.clave_max_convocado) - 4, width: 8, height: 8, class: "p-conv" }));
    if (u.clave_ultimo) g.append(s("circle", { cx: x(i), cy: y(u.clave_ultimo), r: 5, class: "p-ult" + (u.reconstruido ? " calc" : "") }));
    svg.append(g);
    return g;
  });
  const tip = h("div", { class: "tip", role: "status", hidden: true });
  const caja = h("div", { class: "grafico" }, svg, tip,
    h("div", { class: "leyenda" },
      h("span", null, h("i", { style: "background:var(--rojo);border-radius:50%;width:.8em" }), "Último llamado"),
      h("span", null, h("i", { style: "border:1.5px solid var(--tinta-2);width:.8em" }), "Último convocado"),
      h("span", null, h("i", { style: "border:2px dashed var(--rojo);border-radius:50%;width:.8em;background:var(--panel)" }), "Calculado con otras semanas"),
      mia ? h("span", null, h("i", { style: "border-top:3px dashed var(--oro);height:0" }), "Tu posición") : null,
      h("span", null, "Más arriba = más al fondo de la lista. La altura indica orden, no distancia. Pasa el ratón (o toca) por el gráfico para ver cada semana.")));

  let activo = -1;
  const mostrar = (i, ev) => {
    if (i < 0) { tip.hidden = true; guia.style.display = "none"; puntos.forEach((g) => g.classList.remove("on")); activo = -1; return; }
    const { u, a } = serie[i];
    if (i !== activo) {
      puntos.forEach((g, k) => g.classList.toggle("on", k === i));
      const sit = mia ? situacion(mia.clave, u) : null;
      llenar(tip,
        h("strong", null, `Oferta del ${fmtDMA(a.fecha_oferta)}`),
        h("div", null, u.vacantes ? `${miles(u.adjudicadas)} de ${miles(u.vacantes)} plazas adjudicadas` : `${miles(u.adjudicadas)} plazas adjudicadas`),
        h("div", null, u.clave_ultimo ? `Último llamado: ${u.relacion_ultimo ? `n.º ${miles(u.relacion_ultimo)}` + (u.convocados ? ` de ${miles(u.convocados)}` : "") : textoClave(u.clave_ultimo)}` : "Último llamado: —"),
        u.clave_ultimo && u.relacion_ultimo ? h("div", { class: "tenue peq" }, textoClave(u.clave_ultimo)) : null,
        u.clave_max_convocado ? h("div", { class: "tenue peq" }, `Último convocado: ${textoClave(u.clave_max_convocado)}`) : null,
        u.reconstruido ? h("div", { class: "peq", style: "color:var(--rojo)" }, "Calculado con listas de otras semanas") : null,
        sit ? h("div", { class: "peq", style: "margin-top:.25rem;font-weight:600" }, sit.texto) : null);
      activo = i;
    }
    tip.hidden = false;
    guia.setAttribute("x1", x(i)); guia.setAttribute("x2", x(i)); guia.style.display = "";
    const r = caja.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    const px = sr.left - r.left + (x(i) / W) * sr.width;
    const ancho = tip.offsetWidth;
    let left = px + 14; if (left + ancho > r.width - 6) left = px - ancho - 14;
    tip.style.left = Math.max(6, left) + "px";
    tip.style.top = (ev ? Math.max(6, ev.clientY - r.top - tip.offsetHeight - 10) : 20) + "px";
  };
  const masCercano = (ev) => {
    const sr = svg.getBoundingClientRect();
    const vx = ((ev.clientX - sr.left) / sr.width) * W;
    let mejor = 0, d = Infinity;
    serie.forEach((_, i) => { const dd = Math.abs(x(i) - vx); if (dd < d) { d = dd; mejor = i; } });
    return mejor;
  };
  svg.addEventListener("pointermove", (ev) => mostrar(masCercano(ev), ev));
  svg.addEventListener("pointerdown", (ev) => mostrar(masCercano(ev), ev));
  svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") mostrar(-1); });
  return caja;
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
