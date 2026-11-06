// Sección "Vacantes": búsqueda con filtros sobre las vacantes del curso.
import { h, llenar, norm, miles, fmtCorta, fmtDMA, centroBonito, localidadBonita, csv, descargar, esMaestros } from "./util.js";
import { D, YO, nombreEsp, nombreCuerpo } from "./datos.js";
import { nombreEspBonito } from "./comun.js";
import { botonMapa, botonFavorito, mostrarAvisoFav } from "./botonescentro.js";
import { CUENTA } from "./cuenta.js";
import { cargarMunicipios, km, textoKm, textoTiempo, coordsLocalidad } from "./distancia.js";
import { leerRuta } from "./ruta.js";

export const F = {
  cuerpo: null, semana: "ult1", prov: "", loc: "", centro: "", esp: "", estado: "todas", jornada: "", duracion: "",
  tipo: "todas", mis: false, fav: false, cerca: "0", orden: "fecha", dir: -1, n: 50,
};

// ---------- cerca de casa (solo con cuenta y municipio elegido) ----------
let casaXY = null, casaClave = "";       // coordenadas del municipio de la persona, cuando ya se han cargado
const kmCache = new Map();               // localidad -> km en línea recta desde casa (o null si no hay coordenadas)
const casaActual = () => (CUENTA.activa && !CUENTA.verComo ? CUENTA.perfil?.casa || "" : "");
function cargarCasa(alListo) {
  const casa = casaActual();
  if (!casa) { casaXY = null; casaClave = ""; kmCache.clear(); return; }
  if (casaClave === casa && casaXY) return;
  cargarMunicipios().then((d) => {
    const m = d.porClave.get(casa);
    casaXY = m ? { lat: m.lat, lon: m.lon } : null; casaClave = casa; kmCache.clear();
    if (casaXY) alListo();
  }).catch(() => { /* sin distancias */ });
}
/** Km en línea recta desde el municipio de la persona hasta la localidad de la vacante, o null si no se puede calcular. */
export function kmDesdeCasa(localidad) {
  if (!casaXY) return null;
  if (!kmCache.has(localidad)) { const c = coordsLocalidad(localidad); kmCache.set(localidad, c ? km(casaXY, c) : null); }
  return kmCache.get(localidad);
}
const OPC_CERCA = [["0", "Cualquier distancia"], ["10", "Hasta 10 km"], ["25", "Hasta 25 km"], ["50", "Hasta 50 km"], ["100", "Hasta 100 km"]];

/** Actos que entran según cuerpo y semana. Sirve también para el mapa. */
export function actosEnAlcance(cuerpo, semana) {
  const del = D.actos.filter((a) => a.curso === D.curso && (cuerpo === "todos" || a.cuerpo === cuerpo));
  if (semana === "todo") return new Set(del.map((a) => a.acto));
  if (/^ult\d+$/.test(semana)) {
    const n = +semana.slice(3);
    const fechas = [...new Set(del.map((a) => a.fecha_oferta))].sort().reverse().slice(0, n);
    return new Set(del.filter((a) => fechas.includes(a.fecha_oferta)).map((a) => a.acto));
  }
  return new Set(del.filter((a) => a.acto === semana).map((a) => a.acto));
}
export function opcionesSemana(cuerpo) {
  const del = D.actos.filter((a) => a.curso === D.curso && (cuerpo === "todos" || a.cuerpo === cuerpo));
  return [["ult1", "Última semana"], ["ult4", "Últimas 4 semanas"], ["todo", "Todo el curso"]]
    .concat(del.map((a) => [a.acto, `${fmtCorta(a.fecha_oferta)} (${a.acto})`]));
}

export function filtrar(f = F) {
  const actos = actosEnAlcance(f.cuerpo, f.semana);
  const loc = norm(f.loc), centro = norm(f.centro);
  const destinos = new Set(YO.destinos), favoritos = new Set(YO.favoritos.map((x) => x.cod));
  return D.vacantes.filter((v) => {
    if (!actos.has(v.acto)) return false;
    if (f.cuerpo !== "todos" && esMaestros(v.cuerpo_cod) !== (f.cuerpo === "maestros")) return false;
    if (f.prov && v.provincia !== f.prov) return false;
    if (loc && !norm(localidadBonita(v.localidad)).includes(loc) && !norm(v.localidad).includes(loc)) return false;
    if (centro && !norm(v.centro).includes(centro)) return false;
    if (f.esp && `${v.cuerpo_cod}|${v.esp}` !== f.esp) return false;
    if (f.estado === "adjudicada" && v.estado !== "adjudicada") return false;
    if (f.estado === "sin" && v.estado === "adjudicada") return false;
    if (f.jornada && v.jornada !== f.jornada) return false;
    if (f.duracion && v.duracion !== f.duracion) return false;
    if (f.tipo === "ordinarias" && v.singular) return false;
    if (f.tipo === "singulares" && !v.singular) return false;
    if (f.mis && !destinos.has(v.localidad)) return false;
    if (f.fav && !favoritos.has(v.centro_cod)) return false;
    if (+f.cerca && casaXY) { const d = kmDesdeCasa(v.localidad); if (d == null || d > +f.cerca) return false; }
    return true;
  });
}

const ESTADO = { adjudicada: ["Adjudicada", true], ofertada: ["Sin adjudicar", false], no_adjudicada: ["Sin adjudicar", false] };

export function vacantes(raiz, params = {}) {
  F.cuerpo ||= YO.cuerpo;
  if (params.centro !== undefined) Object.assign(F, { loc: "", prov: "", esp: "", jornada: "", duracion: "", tipo: "todas", mis: false, fav: false, cerca: "0" });   // vienes de un aviso o del botón de un centro
  for (const k of ["cuerpo", "semana", "prov", "loc", "esp", "estado", "centro"]) if (params[k]) F[k] = params[k];
  if (params.mis) F.mis = params.mis === "1";
  if (params.fav) F.fav = params.fav === "1";
  if (params.cerca && OPC_CERCA.some(([v]) => v === params.cerca)) F.cerca = params.cerca;
  if (Object.keys(params).length) F.n = 50;
  cargarCasa(() => { if (leerRuta().vista === "vacantes") vacantes(raiz); });     // al terminar de cargar los municipios se repinta con el filtro de distancia

  const sel = (id, etiqueta, opciones, clave) => h("label", null, etiqueta,
    h("select", { id, onchange: (e) => { F[clave] = e.target.value; if (clave === "cuerpo") { F.esp = ""; F.semana = "ult1"; vacantes(raiz); } else { F.n = 50; pintar(); } } },
      opciones.map(([v, t]) => h("option", { value: v, selected: v === F[clave] }, t))));

  const delCuerpo = D.vacantes.filter((v) => F.cuerpo === "todos" || esMaestros(v.cuerpo_cod) === (F.cuerpo === "maestros"));
  const espOpc = [...new Map(delCuerpo.map((v) => [`${v.cuerpo_cod}|${v.esp}`, v])).values()]
    .map((v) => [`${v.cuerpo_cod}|${v.esp}`, `${v.esp}: ${nombreEspBonito(v.cuerpo_cod, v.esp)}`]).sort((a, b) => a[1].localeCompare(b[1], "es"));
  const locs = [...new Set(delCuerpo.map((v) => v.localidad))].sort((a, b) => a.localeCompare(b, "es"));
  const unicos = (campo) => [...new Set(D.vacantes.map((v) => v[campo]).filter(Boolean))].sort();

  const lista = h("datalist", { id: "lista-loc" }, locs.map((l) => h("option", { value: localidadBonita(l) })));
  const filtros = h("form", { class: "filtros", onsubmit: (e) => e.preventDefault(), "aria-label": "Filtros de vacantes" },
    sel("f-cuerpo", "Cuerpo", [["maestros", "Maestros"], ["secundaria", "Secundaria y otros"], ["todos", "Todos"]], "cuerpo"),
    sel("f-semana", "Semana", opcionesSemana(F.cuerpo), "semana"),
    sel("f-prov", "Provincia", [["", "Todas"], ...unicos("provincia").map((p) => [p, localidadBonita(p)])], "prov"),
    h("label", null, "Localidad", h("input", { type: "text", id: "f-loc", list: "lista-loc", value: F.loc, placeholder: "Todas", oninput: (e) => { F.loc = e.target.value; F.n = 50; pintar(); } }), lista),
    h("label", null, "Centro", h("input", { type: "search", id: "f-centro", value: F.centro, placeholder: "Nombre del centro", oninput: (e) => { F.centro = e.target.value; F.n = 50; pintar(); } })),
    sel("f-esp", "Especialidad", [["", "Todas"], ...espOpc], "esp"),
    sel("f-estado", "Estado", [["todas", "Todas"], ["adjudicada", "Adjudicadas"], ["sin", "Sin adjudicar"]], "estado"),
    sel("f-jornada", "Jornada", [["", "Cualquiera"], ...unicos("jornada").map((x) => [x, x])], "jornada"),
    sel("f-duracion", "Duración", [["", "Cualquiera"], ...unicos("duracion").map((x) => [x, x])], "duracion"),
    sel("f-tipo", "Tipo", [["todas", "Todas"], ["ordinarias", "Ordinarias"], ["singulares", "Singularizadas"]], "tipo"),
    casaXY ? sel("f-cerca", "Cerca de mi casa", OPC_CERCA, "cerca") : null,
    YO.destinos.length ? h("label", { class: "check" }, h("input", { type: "checkbox", id: "f-mis", checked: F.mis, onchange: (e) => { F.mis = e.target.checked; F.n = 50; pintar(); } }), "Solo mis destinos") : null,
    YO.favoritos.length ? h("label", { class: "check" }, h("input", { type: "checkbox", id: "f-fav", checked: F.fav, onchange: (e) => { F.fav = e.target.checked; F.n = 50; pintar(); } }), "Solo mis favoritos") : null,
    h("button", { type: "button", class: "boton sec", id: "limpiar", onclick: () => { Object.assign(F, { semana: "ult1", prov: "", loc: "", centro: "", esp: "", estado: "todas", jornada: "", duracion: "", tipo: "todas", mis: false, fav: false, cerca: "0", n: 50 }); vacantes(raiz); } }, "Quitar filtros"));

  const zona = h("div", { id: "zona-vacantes" });
  llenar(raiz, 
    h("div", { class: "cabecera-vista" }, h("h2", null, "Vacantes"),
      h("p", { class: "tenue" }, "Todas las vacantes ofertadas y adjudicadas del curso, con los filtros que necesites. En cada fila, el mapa te dice a cuánto está de tu casa y la estrella guarda el centro en Mi seguimiento para avisarte de novedades.")),
    filtros,
    casaXY ? null : h("p", { class: "tenue peq", id: "cerca-ayuda" }, CUENTA.activa && !CUENTA.verComo
      ? ["Para filtrar y ordenar por la distancia desde tu casa, elige tu municipio en ", h("a", { href: "#/yo" }, "Mi seguimiento"), " (Mi casa)."]
      : "Con una cuenta puedes filtrar y ordenar las vacantes por la distancia desde tu municipio."),
    h("p", { class: "aviso-fav", id: "aviso-fav", role: "status", "aria-live": "polite", hidden: true }), zona);

  function pintar() {
    const todas = filtrar();
    const dir = F.dir;
    const clave = {
      fecha: (v) => v.fecha_adj || "", esp: (v) => nombreEsp(v.cuerpo_cod, v.esp), loc: (v) => v.localidad, centro: (v) => v.centro, estado: (v) => v.estado,
      dist: (v) => kmDesdeCasa(v.localidad) ?? 1e9,       // sin coordenadas, al final
    }[casaXY || F.orden !== "dist" ? F.orden : "fecha"];
    todas.sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0) * dir || a.localidad.localeCompare(b.localidad, "es") || a.vacante - b.vacante);
    const adj = todas.filter((v) => v.estado === "adjudicada").length;
    const ord = (c, t, cls) => h("th", { class: cls || "", "aria-sort": F.orden === c ? (F.dir > 0 ? "ascending" : "descending") : "none" },
      h("button", { type: "button", onclick: () => { F.dir = F.orden === c ? -F.dir : (c === "fecha" ? -1 : 1); F.orden = c; pintar(); } }, t + (F.orden === c ? (F.dir > 0 ? " ▲" : " ▼") : "")));
    const destinos = new Set(YO.destinos);
    const filas = todas.slice(0, F.n).map((v) => h("tr", { class: destinos.has(v.localidad) ? "mio" : "" },
      h("td", null, fmtCorta(v.fecha_adj)),
      h("td", null, h("span", { class: "cod num" }, v.esp), " ", nombreEspBonito(v.cuerpo_cod, v.esp), v.perfilada === "Si" ? h("div", { class: "peq tenue" }, `Perfil: ${v.perfil || "perfilada"}`) : null),
      h("td", null, centroBonito(v.centro), h("div", { class: "peq tenue" }, `${localidadBonita(v.localidad)} (${localidadBonita(v.provincia)})`)),
      casaXY ? celdaDistancia(kmDesdeCasa(v.localidad)) : null,
      h("td", null, v.jornada || "—"),
      h("td", null, v.duracion || "—", v.fecha_fin_estimada ? h("div", { class: "peq tenue" }, `hasta ${fmtDMA(v.fecha_fin_estimada)}`) : null),
      h("td", null, v.causa || v.obligacion || "—", v.singular ? h("div", { class: "peq tenue" }, "Singularizada") : null),
      h("td", { class: "estado" }, h("span", { class: "punto" + (ESTADO[v.estado][1] ? " lleno" : "") }), ESTADO[v.estado][0]),
      h("td", { class: "acciones-fila" }, botonMapa(v), botonFavorito(v, alCambiar))));
    llenar(zona, 
      h("div", { class: "mas", style: "margin-top:0" },
        h("p", { style: "margin:0", id: "contador", "aria-live": "polite" }, `${miles(todas.length)} vacantes (${miles(adj)} adjudicadas, ${miles(todas.length - adj)} sin adjudicar).`),
        todas.length ? h("button", { type: "button", class: "boton sec", id: "csv", onclick: () => exportar(todas) }, "Descargar CSV") : null),
      casaXY && todas.length ? h("p", { class: "tenue peq", id: "nota-distancia" }, `Distancias en línea recta desde ${casaClave}; por carretera suele ser más (el tiempo en coche es aproximado y sin tráfico).`) : null,
      todas.length
        ? h("div", { class: "tabla-wrap" }, h("table", { class: "datos", id: "tabla-vacantes" },
          h("thead", null, h("tr", null, ord("fecha", "Adjudicación"), ord("esp", "Especialidad"), ord("centro", "Centro y localidad"), casaXY ? ord("dist", "Distancia") : null, h("th", null, "Jornada"), h("th", null, "Duración"), h("th", null, "Motivo"), ord("estado", "Estado"), h("th", null, h("span", { class: "solo-lector" }, "Mapa y favorito")))),
          h("tbody", null, filas)))
        : h("p", { class: "vacio" }, "Ninguna vacante cumple estos filtros. Prueba con «Todo el curso» o quita algún filtro."),
      todas.length > F.n ? h("div", { class: "mas" }, h("button", { type: "button", class: "boton sec", id: "mas", onclick: () => { F.n += 50; pintar(); } }, "Mostrar 50 más"), h("span", { class: "tenue peq" }, `Mostrando ${miles(Math.min(F.n, todas.length))} de ${miles(todas.length)}`)) : null);
  }
  const alCambiar = (texto) => { pintar(); mostrarAvisoFav(texto); };
  pintar();
}

function celdaDistancia(d) {
  return d == null ? h("td", { class: "tenue" }, "—")
    : h("td", { class: "dist" }, h("strong", { class: "num" }, textoKm(d)), h("div", { class: "peq tenue" }, textoTiempo(d)));
}

function exportar(filas) {
  const cols = [
    ["Acto", (v) => v.acto], ["Fecha adjudicación", (v) => v.fecha_adj], ["Cuerpo", (v) => nombreCuerpo(v.cuerpo_cod)],
    ["Especialidad", (v) => `${v.esp} ${nombreEsp(v.cuerpo_cod, v.esp)}`], ["Centro", (v) => v.centro], ["Localidad", (v) => v.localidad],
    ["Provincia", (v) => v.provincia], ["Jornada", (v) => v.jornada], ["Duración", (v) => v.duracion], ["Motivo", (v) => v.causa],
    ["Estado", (v) => ESTADO[v.estado][0]], ["Singularizada", (v) => (v.singular ? "Sí" : "No")],
  ];
  if (casaXY) cols.push(["Km en línea recta desde mi casa", (v) => { const d = kmDesdeCasa(v.localidad); return d == null ? "" : d.toFixed(1).replace(".", ","); }]);
  descargar(`vacantes-aragon-${D.curso}.csv`, csv(filas, cols));
}
