// Sección "Mapa": vacantes por localidad sobre un mapa propio (SVG, sin servicios externos).
import { h, s, llenar, miles, localidadBonita } from "./util.js";
import { D, YO, guardarYo, nombreEsp } from "./datos.js";
import { puedeSeguir } from "./cuenta.js";
import { ir } from "./ruta.js";
import { filtrar, opcionesSemana } from "./vacantes.js";
import { nombreEspBonito } from "./comun.js";
import { PROVINCIAS_GEO } from "./geo_aragon.js";

const FM = { cuerpo: null, semana: "ult4", prov: "", loc: "", centro: "", esp: "", estado: "todas", jornada: "", duracion: "", tipo: "todas", mis: false };
const LON0 = -2.35, LON1 = 0.85, LAT0 = 39.75, LAT1 = 42.95, K = Math.cos((41.4 * Math.PI) / 180) * 100;
const proj = (lat, lon) => [(lon - LON0) * K, (LAT1 - lat) * 100];
const ANCHO = (LON1 - LON0) * K, ALTO = (LAT1 - LAT0) * 100;
const PROVINCIAS = [["HUESCA", 42.35, -0.15], ["ZARAGOZA", 41.25, -1.55], ["TERUEL", 40.45, -0.9]];

let seleccion = null;

export function mapa(raiz, params = {}) {
  FM.cuerpo ||= YO.cuerpo;
  for (const k of Object.keys(FM)) if (params[k]) FM[k] = params[k];

  const sel = (id, etiqueta, opciones, clave) => h("label", null, etiqueta,
    h("select", { id, onchange: (e) => { FM[clave] = e.target.value; if (clave === "cuerpo") { FM.esp = ""; FM.semana = "ult4"; seleccion = null; mapa(raiz); } else pintar(); } },
      opciones.map(([v, t]) => h("option", { value: v, selected: v === FM[clave] }, t))));
  const delCuerpo = D.vacantes.filter((v) => FM.cuerpo === "todos" || (v.cuerpo_cod === "0597") === (FM.cuerpo === "maestros"));
  const espOpc = [...new Map(delCuerpo.map((v) => [`${v.cuerpo_cod}|${v.esp}`, v])).values()]
    .map((v) => [`${v.cuerpo_cod}|${v.esp}`, `${v.esp}: ${nombreEspBonito(v.cuerpo_cod, v.esp)}`]).sort((a, b) => a[1].localeCompare(b[1], "es"));

  const zonaMapa = h("div", { class: "mapa-caja", id: "mapa-caja" });
  const panel = h("aside", { class: "mapa-panel", id: "mapa-panel", "aria-live": "polite" });
  llenar(raiz, 
    h("div", { class: "cabecera-vista" }, h("h2", null, "Mapa de vacantes"),
      h("p", { class: "tenue" }, "El tamaño de cada círculo es el número de vacantes en esa localidad con los filtros elegidos. Arrastra para mover y usa los botones o la rueda para acercar.")),
    h("form", { class: "filtros", onsubmit: (e) => e.preventDefault() },
      sel("m-cuerpo", "Cuerpo", [["maestros", "Maestros"], ["secundaria", "Secundaria y otros"], ["todos", "Todos"]], "cuerpo"),
      sel("m-semana", "Semana", opcionesSemana(FM.cuerpo), "semana"),
      sel("m-esp", "Especialidad", [["", "Todas"], ...espOpc], "esp"),
      sel("m-estado", "Estado", [["todas", "Todas"], ["adjudicada", "Adjudicadas"], ["sin", "Sin adjudicar"]], "estado")),
    h("div", { class: "mapa-grid" }, zonaMapa, panel));

  let vb = { x: 0, y: 0, w: ANCHO, h: ALTO };
  let svg, nube, grupos = [];

  function pintar() {
    const filas = filtrar(FM);
    const por = new Map();
    for (const v of filas) {
      if (!por.has(v.localidad)) por.set(v.localidad, { loc: v.localidad, prov: v.provincia, n: 0, adj: 0, esp: new Map() });
      const g = por.get(v.localidad);
      g.n++; if (v.estado === "adjudicada") g.adj++;
      const k = `${v.cuerpo_cod}|${v.esp}`; g.esp.set(k, (g.esp.get(k) || 0) + 1);
    }
    grupos = [...por.values()].sort((a, b) => b.n - a.n);
    const sinCoords = grupos.filter((g) => D.locs[g.loc]?.lat == null);
    svg = s("svg", { viewBox: `0 0 ${ANCHO} ${ALTO}`, role: "group", "aria-label": "Mapa de Aragón con círculos por localidad", id: "mapa-svg" });
    for (const [nombre, anillos] of Object.entries(PROVINCIAS_GEO)) {
      const d = anillos.map((r) => "M" + r.map(([lo, la]) => proj(la, lo).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("");
      svg.append(s("path", { d, class: "prov prov-" + nombre.toLowerCase(), "aria-hidden": "true" }));
    }
    for (const [n, la, lo] of PROVINCIAS) { const [x, y] = proj(la, lo); svg.append(s("text", { x, y, "text-anchor": "middle", class: "etiqueta-prov" }, n)); }
    for (const l of Object.values(D.locs)) if (l.lat != null) { const [x, y] = proj(l.lat, l.lon); svg.append(s("circle", { cx: x, cy: y, r: 0.8, class: "fondo-loc" })); }
    nube = s("g", { class: "nube" });
    svg.append(nube);
    dibujar();
    llenar(zonaMapa, svg, h("div", { class: "mapa-zoom" },
      h("button", { type: "button", "aria-label": "Acercar", id: "zoom-mas", onclick: () => zoom(1.6) }, "+"),
      h("button", { type: "button", "aria-label": "Alejar", id: "zoom-menos", onclick: () => zoom(1 / 1.6) }, "−"),
      h("button", { type: "button", "aria-label": "Ver todo Aragón", id: "zoom-todo", onclick: () => { vb = { x: 0, y: 0, w: ANCHO, h: ALTO }; dibujar(); } }, "⌂")));
    enlazarGestos();
    if (!seleccion || !por.has(seleccion)) seleccion = null;
    panelDe(seleccion ? por.get(seleccion) : null, filas.length, sinCoords);
  }

  function dibujar() {
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const z = ANCHO / vb.w;
    nube.replaceChildren();
    const rotulos = [];
    for (const g of grupos) {
      const c = D.locs[g.loc];
      if (!c || c.lat == null) continue;
      const [x, y] = proj(c.lat, c.lon);
      const r = (1.4 + 0.95 * Math.sqrt(g.n)) / Math.pow(z, 0.75);
      const cir = s("circle", { cx: x, cy: y, r, class: g.loc === seleccion ? "sel" : "", tabindex: 0, role: "button", "aria-label": `${localidadBonita(g.loc)}: ${g.n} vacantes`,
        "data-loc": g.loc, onclick: () => elegir(g.loc), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(g.loc); } } },
      s("title", null, `${localidadBonita(g.loc)}: ${g.n} vacantes`));
      nube.append(cir);
      if (g.n >= 25 / Math.sqrt(z) || z > 2.6 || g.loc === seleccion) rotulos.push(s("text", { x: x + r + 1.5 / z, y: y + 3 / z, class: "etiqueta-loc", style: `font-size:${11 / z}px;stroke-width:${3 / z}px` }, `${localidadBonita(g.loc)} ${g.n}`));
    }
    nube.append(...rotulos);
  }

  function zoom(f, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) {
    const w = Math.max(ANCHO / 14, Math.min(ANCHO, vb.w / f)), hh = w * (ALTO / ANCHO);
    const rx = (cx - vb.x) / vb.w, ry = (cy - vb.y) / vb.h;
    vb = { x: Math.max(-10, Math.min(ANCHO - w + 10, cx - rx * w)), y: Math.max(-10, Math.min(ALTO - hh + 10, cy - ry * hh)), w, h: hh };
    dibujar();
  }

  function enlazarGestos() {
    const aUnidades = (e) => { const r = svg.getBoundingClientRect(); return [vb.x + ((e.clientX - r.left) / r.width) * vb.w, vb.y + ((e.clientY - r.top) / r.height) * vb.h, r]; };
    svg.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = aUnidades(e); zoom(e.deltaY < 0 ? 1.25 : 0.8, x, y); }, { passive: false });
    let arrastre = null;
    svg.addEventListener("pointerdown", (e) => { if (e.target.closest("circle[data-loc]")) return; arrastre = { x: e.clientX, y: e.clientY, vb: { ...vb } }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener("pointermove", (e) => {
      if (!arrastre) return;
      const r = svg.getBoundingClientRect();
      vb = { ...arrastre.vb, x: arrastre.vb.x - ((e.clientX - arrastre.x) / r.width) * vb.w, y: arrastre.vb.y - ((e.clientY - arrastre.y) / r.height) * vb.h };
      dibujar();
    });
    const fin = () => { arrastre = null; };
    svg.addEventListener("pointerup", fin); svg.addEventListener("pointercancel", fin);
  }

  function elegir(loc) {
    seleccion = loc;
    const g = grupos.find((x) => x.loc === loc);
    dibujar();
    panelDe(g, null, []);
  }

  function panelDe(g, total, sinCoords) {
    if (!g) {
      llenar(panel, 
        h("h3", null, "Localidades"),
        h("p", { id: "mapa-resumen" }, total ? `${miles(total)} vacantes en ${grupos.length} localidades.` : "No hay vacantes con estos filtros."),
        grupos.length ? [h("p", { class: "tenue peq" }, "Pulsa un círculo para ver el detalle. Las más habituales:"),
          h("ul", null, grupos.slice(0, 8).map((x) => h("li", null, h("button", { type: "button", class: "boton sec", style: "padding:.1rem .5rem;min-height:30px;margin:.1rem 0", onclick: () => elegir(x.loc) }, `${localidadBonita(x.loc)}: ${x.n}`))))] : null,
        sinCoords?.length ? h("p", { class: "tenue peq" }, `Sin coordenadas todavía: ${sinCoords.map((x) => localidadBonita(x.loc)).join(", ")}.`) : null);
      return;
    }
    const c = D.locs[g.loc];
    const esp = [...g.esp.entries()].sort((a, b) => b[1] - a[1]);
    const es = YO.destinos.includes(g.loc);
    llenar(panel, 
      h("h3", { id: "mapa-loc" }, `${localidadBonita(g.loc)} (${localidadBonita(g.prov)})`),
      h("p", null, `${miles(g.n)} vacantes: ${miles(g.adj)} adjudicadas y ${miles(g.n - g.adj)} sin adjudicar.`),
      h("ul", null, esp.slice(0, 8).map(([k, n]) => h("li", null, `${nombreEspBonito(...k.split("|"))}: ${n}`)), esp.length > 8 ? h("li", { class: "tenue" }, `y ${esp.length - 8} especialidades más`) : null),
      c?.aprox ? h("p", { class: "tenue peq" }, "La posición en el mapa es aproximada.") : null,
      h("div", { class: "campos" },
        h("button", { type: "button", class: "boton", id: "ver-vacantes", onclick: () => ir("vacantes", { loc: localidadBonita(g.loc), cuerpo: FM.cuerpo, semana: FM.semana, esp: FM.esp, estado: FM.estado }) }, "Ver estas vacantes"),
        h("button", { type: "button", class: "boton sec", id: "destino", onclick: () => {
          if (!puedeSeguir()) { ir("yo"); return; }          // los destinos son de Mi seguimiento
          YO.destinos = es ? YO.destinos.filter((d) => d !== g.loc) : [...YO.destinos, g.loc]; guardarYo(); panelDe(g, null, []);
        } }, es ? "Quitar de mis destinos" : "Añadir a mis destinos")),
      puedeSeguir() ? null : h("p", { class: "tenue peq" }, "Guardar destinos es parte de Mi seguimiento."),
      c?.lat != null ? h("p", { class: "peq" }, h("a", { href: `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=13/${c.lat}/${c.lon}`, target: "_blank", rel: "noopener noreferrer" }, "Abrir en OpenStreetMap")) : null);
  }
  pintar();
}
