// Sección "Semana": hasta dónde llegó la lista en cada especialidad en una adjudicación.
import { h, llenar, norm, miles, textoClave, bonito, fmtLarga } from "./util.js";
import { D, YO, guardarYo, actosDe, nombreCuerpo } from "./datos.js";
import { regla, segmento, campoSelect, etiquetaActo, situacion, cabeceraActo, nombreEspBonito, misListas } from "./comun.js";

const estado = { actoId: null, orden: "esp", texto: "" };

export function semana(raiz, params = {}) {
  if (params.cuerpo) { YO.cuerpo = params.cuerpo; guardarYo(); }
  const cuerpo = YO.cuerpo;
  const actos = actosDe(D.curso, cuerpo);
  // Por defecto, la última semana con adjudicación publicada; si hay una oferta más reciente sin adjudicar, se avisa arriba.
  const ultimaAdjudicada = actos.find((a) => a.tiene_adjudicadas);
  if (!actos.some((a) => a.acto === estado.actoId)) estado.actoId = (ultimaAdjudicada || actos.find((a) => a.tiene_candidatos) || actos[0])?.acto;
  const acto = D.actoPorId.get(estado.actoId);
  const pendiente = ultimaAdjudicada && acto === ultimaAdjudicada ? actos.find((a) => a.fecha_oferta > ultimaAdjudicada.fecha_oferta && !a.tiene_adjudicadas) : null;

  const redibujar = () => semana(raiz);
  const controles = h("div", { class: "filtros" },
    h("div", null, h("div", { class: "tenue peq", style: "margin-bottom:.2rem" }, "Cuerpo"),
      segmento([["maestros", "Maestros"], ["secundaria", "Secundaria y otros"]], cuerpo, (v) => { YO.cuerpo = v; guardarYo(); estado.actoId = null; redibujar(); }, "Cuerpo")),
    campoSelect("Semana", actos.map((a) => [a.acto, etiquetaActo(a)]), estado.actoId, (v) => { estado.actoId = v; redibujar(); }, "sel-acto"),
    h("label", null, "Buscar especialidad",
      h("input", { type: "search", id: "buscar-esp", value: estado.texto, placeholder: "p. ej. inglés", oninput: (e) => { estado.texto = e.target.value; pintarLista(); } })));

  const contLista = h("div", { id: "lista-esp" });
  llenar(raiz, cabeceraActo(acto),
    pendiente ? h("p", { class: "aviso-pendiente", id: "aviso-pendiente" }, `Ya está publicada la oferta del ${fmtLarga(pendiente.fecha_oferta)}; la adjudicación todavía no. `,
      h("button", { type: "button", class: "enlace", onclick: () => { estado.actoId = pendiente.acto; redibujar(); } }, "Ver la oferta")) : null,
    controles, contLista);

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
    let cuerpoPrevio = null;
    for (const { u, nombre } of lista) {
      if (cuerpo === "secundaria" && u.cuerpo_cod !== cuerpoPrevio) {
        cuerpoPrevio = u.cuerpo_cod;
        cajas.push(h("div", { class: "cab-lista", style: "display:block;font-weight:700;color:var(--tinta)" }, bonito(nombreCuerpo(u.cuerpo_cod))));
      }
      cajas.push(fila(u, nombre, !acto?.tiene_adjudicadas));
    }
    llenar(contLista, 
      h("div", { class: "lista-esp" }, cab, cajas.length ? cajas : h("p", { class: "vacio", style: "padding:1rem" },
        filas.length ? "Ninguna especialidad coincide con la búsqueda." : "No hay datos de listas para esta semana.")),
      h("p", { class: "tenue peq", style: "margin-top:.75rem" },
        "La barra roja marca hasta qué número de los convocados llegó la adjudicación ordinaria. La posición indica la lista, la fecha del bloque, el bloque y el orden dentro del bloque, tal como figuran en el PDF de candidatos."));
  }
  pintarLista();
}

function fila(u, nombre, pendiente) {
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
    h("div", { class: "posicion posicion-col" }, u.clave_ultimo ? textoClave(u.clave_ultimo) : "—"));
}
