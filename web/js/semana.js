// Sección "Semana": hasta dónde llegó la lista en cada especialidad en una adjudicación.
import { h, llenar, norm, miles, textoClave, bonito, fmtLarga, centroBonito, localidadBonita } from "./util.js";
import { D, YO, guardarYo, actosDe, nombreCuerpo, cargarVacantes } from "./datos.js";
import { botonMapa, botonFavorito, mostrarAvisoFav } from "./botonescentro.js";
import { regla, segmento, campoSelect, etiquetaActo, situacion, cabeceraActo, nombreEspBonito, misListas } from "./comun.js";

const estado = { actoId: null, orden: "esp", texto: "" };
const abiertas = new Set();      // especialidades con la lista de centros desplegada (se conservan al repintar)

export function semana(raiz, params = {}, mantener = false) {
  if (params.cuerpo) { YO.cuerpo = params.cuerpo; guardarYo(); }
  const cuerpo = YO.cuerpo;
  const actos = actosDe(D.curso, cuerpo);
  // Al entrar en la pestaña se enseña siempre la semana más reciente (aunque su adjudicación aún no esté publicada).
  if (!mantener) { estado.actoId = null; abiertas.clear(); }
  if (!actos.some((a) => a.acto === estado.actoId)) estado.actoId = (actos.find((a) => a.tiene_candidatos || a.tiene_adjudicadas) || actos[0])?.acto;
  const acto = D.actoPorId.get(estado.actoId);
  const ultimaAdjudicada = actos.find((a) => a.tiene_adjudicadas);
  const sinAdjudicar = acto && !acto.tiene_adjudicadas && ultimaAdjudicada;

  const redibujar = () => semana(raiz, {}, true);
  const controles = h("div", { class: "filtros" },
    h("div", null, h("div", { class: "tenue peq", style: "margin-bottom:.2rem" }, "Cuerpo"),
      segmento([["maestros", "Maestros"], ["secundaria", "Secundaria y otros"]], cuerpo, (v) => { YO.cuerpo = v; guardarYo(); estado.actoId = null; redibujar(); }, "Cuerpo")),
    campoSelect("Semana", actos.map((a) => [a.acto, etiquetaActo(a)]), estado.actoId, (v) => { estado.actoId = v; redibujar(); }, "sel-acto"),
    h("label", null, "Buscar especialidad",
      h("input", { type: "search", id: "buscar-esp", value: estado.texto, placeholder: "p. ej. inglés", oninput: (e) => { estado.texto = e.target.value; pintarLista(); } })),
    h("a", { class: "boton boton-paddoc", id: "ir-paddoc", href: "#/yo" }, "Solicitud a PADDOC"));

  const contLista = h("div", { id: "lista-esp" });
  llenar(raiz, cabeceraActo(acto),
    sinAdjudicar ? h("p", { class: "aviso-pendiente", id: "aviso-pendiente" }, "Mientras llega la adjudicación: ",
      h("button", { type: "button", class: "enlace", onclick: () => { estado.actoId = ultimaAdjudicada.acto; redibujar(); } }, `Ver la última adjudicación (${fmtLarga(ultimaAdjudicada.fecha_adjudicacion)})`)) : null,
    controles, h("p", { class: "aviso-fav", id: "aviso-fav", role: "status", "aria-live": "polite", hidden: true }), contLista);

  function pintarLista() {
    const filas = (D.ultimoPorActo.get(estado.actoId) || []).filter((u) => (u.cuerpo_cod === "0597") === (cuerpo === "maestros"));
    const q = norm(estado.texto);
    let lista = filas.map((u) => ({ u, nombre: nombreEspBonito(u.cuerpo_cod, u.esp), p: u.relacion_ultimo && u.convocados ? u.relacion_ultimo / u.convocados : -1 }))
      .filter((x) => !q || norm(x.nombre).includes(q) || norm(x.u.esp).includes(q));
    const por = {
      esp: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
      plazas: (a, b) => (b.u.adjudicadas || 0) - (a.u.adjudicadas || 0) || a.nombre.localeCompare(b.nombre, "es"),
      llegada: (a, b) => b.p - a.p,
    }[estado.orden];
    lista.sort(por);

    const orden = (clave, texto) => h("button", { type: "button", "aria-pressed": String(estado.orden === clave), onclick: () => { estado.orden = clave; pintarLista(); } }, texto);
    const cab = h("div", { class: "cab-lista" },
      orden("esp", "Especialidad"), orden("plazas", "Plazas"), orden("llegada", "Hasta dónde llegó la lista"),
      h("span", null, "Posición del último llamado"));
    const cajas = [];
    // Tus listas (las de Mi seguimiento) van siempre arriba, resaltadas, con el mismo orden que el resto; no se repiten abajo.
    const mios = misListas();
    const esMia = (u) => mios.some((l) => l.cuerpo_cod === u.cuerpo_cod && l.esp === u.esp);
    const mias = lista.filter((x) => esMia(x.u)), resto = lista.filter((x) => !esMia(x.u));
    if (mias.length) {
      cajas.push(h("div", { class: "cab-lista cab-grupo cab-mias", id: "cab-mias" }, mias.length === 1 ? "Tu lista" : `Tus listas (${mias.length})`));
      for (const { u, nombre } of mias) cajas.push(fila(u, nombre, !acto?.tiene_adjudicadas, estado.actoId, alCambiar));
      if (resto.length) cajas.push(h("div", { class: "cab-lista cab-grupo", id: "cab-resto" }, "Resto de especialidades"));
    }
    let cuerpoPrevio = null;
    for (const { u, nombre } of resto) {
      if (cuerpo === "secundaria" && u.cuerpo_cod !== cuerpoPrevio) {
        cuerpoPrevio = u.cuerpo_cod;
        cajas.push(h("div", { class: "cab-lista cab-grupo cab-cuerpo" }, bonito(nombreCuerpo(u.cuerpo_cod))));
      }
      cajas.push(fila(u, nombre, !acto?.tiene_adjudicadas, estado.actoId, alCambiar));
    }
    llenar(contLista, 
      h("div", { class: "lista-esp" }, cab, cajas.length ? cajas : h("p", { class: "vacio", style: "padding:1rem" },
        filas.length ? "Ninguna especialidad coincide con la búsqueda." : "No hay datos de listas para esta semana.")),
      h("p", { class: "tenue peq", style: "margin-top:.75rem" },
        "La barra roja marca hasta qué número de los convocados llegó la adjudicación ordinaria. La posición indica la lista, la fecha del bloque, el bloque y el orden dentro del bloque, tal como figuran en el PDF de candidatos."));
  }
  const alCambiar = (texto) => { pintarLista(); mostrarAvisoFav(texto); };
  pintarLista();
}

/** Vacantes de una especialidad en esa semana, una fila por vacante y al final los botones de mapa y favorito (como en Vacantes). */
function tablaCentros(u, actoId, alCambiar) {
  const vs = D.vacantes.filter((v) => v.acto === actoId && v.cuerpo_cod === u.cuerpo_cod && v.esp === u.esp)
    .sort((a, b) => a.localidad.localeCompare(b.localidad, "es") || a.centro.localeCompare(b.centro, "es") || a.vacante - b.vacante);
  if (!vs.length) return h("p", { class: "tenue peq" }, "No hay vacantes con centro para esta especialidad en esta semana.");
  return h("div", { class: "tabla-wrap" }, h("table", { class: "datos tabla-centros" },
    h("thead", null, h("tr", null, h("th", null, "Centro y localidad"), h("th", null, "Jornada"), h("th", null, "Duración"), h("th", null, "Estado"), h("th", null, h("span", { class: "solo-lector" }, "Mapa y favorito")))),
    h("tbody", null, vs.map((v) => h("tr", null,
      h("td", null, centroBonito(v.centro), h("div", { class: "peq tenue" }, `${localidadBonita(v.localidad)} (${localidadBonita(v.provincia)})`)),
      h("td", null, v.jornada || "—"),
      h("td", null, v.duracion || "—"),
      h("td", { class: "estado" }, h("span", { class: "punto" + (v.estado === "adjudicada" ? " lleno" : "") }), v.estado === "adjudicada" ? "Adjudicada" : "Sin adjudicar"),
      h("td", { class: "acciones-fila" }, botonMapa(v), botonFavorito(v, alCambiar)))))));
}

function desplegable(u, actoId, alCambiar) {
  const clave = `${actoId}|${u.cuerpo_cod}|${u.esp}`;
  const cuerpo = h("div", { class: "centros-cuerpo" });
  const pintar = async () => {
    if (D.vacantes._curso !== D.curso) {
      llenar(cuerpo, h("p", { class: "tenue", role: "status" }, "Cargando vacantes…"));
      try { const v = await cargarVacantes(D.curso); v._curso = D.curso; } catch (e) { llenar(cuerpo, h("p", { class: "error-txt", role: "alert" }, "No se han podido cargar las vacantes. Inténtalo de nuevo.")); return; }
    }
    llenar(cuerpo, tablaCentros(u, actoId, alCambiar));
  };
  const det = h("details", { class: "centros-esp", open: abiertas.has(clave), ontoggle: () => { if (det.open) { abiertas.add(clave); pintar(); } else abiertas.delete(clave); } },
    h("summary", null, "Ver centros y vacantes"), cuerpo);
  if (det.open) pintar();
  return det;
}

function fila(u, nombre, pendiente, actoId, alCambiar) {
  const mias = misListas().filter((l) => l.cuerpo_cod === u.cuerpo_cod && l.esp === u.esp);
  const sit = mias.length ? situacion(mias[0].clave, u) : null;
  const sinLista = !u.convocados;
  const plazas = pendiente ? (u.vacantes ? `${miles(u.vacantes)} ${u.vacantes === 1 ? "plaza ofertada" : "plazas ofertadas"}` : "—") : u.vacantes
    ? (u.adjudicadas === u.vacantes ? `${miles(u.adjudicadas)} plazas` : `${miles(u.adjudicadas)} de ${miles(u.vacantes)}`)
    : (u.adjudicadas ? `${miles(u.adjudicadas)} plazas` : "—");
  return h("div", { class: "fila-esp" + (mias.length ? " mia" : "") },
    h("div", { class: "nombre" }, h("span", { class: "cod" }, u.esp), nombre,
      sit ? h("div", null, h("span", { class: "chip oro", style: "margin-top:.25rem" }, sit.texto)) : null),
    h("div", { class: "plazas" }, plazas),
    h("div", { class: "llego" },
      regla(u.relacion_ultimo, u.convocados),
      h("div", { class: "llego-texto" },
        pendiente ? h("small", null, `Adjudicación pendiente${u.convocados ? ` (${miles(u.convocados)} convocados)` : ""}`) :
        sinLista && u.reconstruido ? h("small", null, "Sin listado de candidatos esta semana: el último llamado se ha calculado con listas de otras semanas")
          : sinLista ? h("small", null, "Sin listado de candidatos publicado esta semana")
          : u.relacion_ultimo ? [`n.º ${miles(u.relacion_ultimo)} `, h("small", null, `de ${miles(u.convocados)} convocados`)]
            : h("small", null, `Sin adjudicaciones ordinarias de esta lista (${miles(u.convocados)} convocados)`))),
    h("div", { class: "posicion posicion-col" }, u.clave_ultimo ? textoClave(u.clave_ultimo) : "—"),
    u.vacantes || u.adjudicadas ? desplegable(u, actoId, alCambiar) : null);
}
