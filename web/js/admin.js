// Administración (solo docentscv@gmail.com; lo comprueba el servidor en cada llamada, no esta pantalla).
// Secciones como en DocentsCV: Usuarios y pagos · Embudo · Sugerencias y reclamaciones · Pruebas terminadas sin pagar · Subir PDF.
import { h, llenar, miles, fmtDMA } from "./util.js";
import { CUENTA, adminResumen, adminUsuarios, adminEmbudo, adminPruebasTerminadas, adminAccion, adminMensajes, adminResponder, verComo,
  adminListarPdf, adminSubirPdf, adminBorrarPdf } from "./cuenta.js";
import { segmento } from "./comun.js";
import { ir } from "./ruta.js";

const SECCIONES = [
  ["usuarios", "Usuarios y pagos"], ["embudo", "Embudo"], ["mensajes", "Sugerencias y reclamaciones"],
  ["pruebas", "Pruebas terminadas sin pagar (22 días o más)"], ["pdf", "Subir PDF"],
];
const TIPO_PASE = { prueba: "Prueba", pago_unico: "Pago único", suscripcion: "Suscripción", invitaciones: "Gratis por invitar", manual: "Regalo" };
const RESULTADO = { ok: "Hecho.", ya_tiene: "Ya tiene un pase regalado en vigor.", invalido: "Dato no válido.", no_existe: "Esa cuenta ya no existe.", limite: "Límite alcanzado." };
const URL_ROBOT = (window.CONFIG || {}).urlRobot || "https://github.com/docentesaragon/docentesaragon.github.io/actions/workflows/semanal.yml";
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : "—");

export function admin(raiz, params = {}) {
  if (!CUENTA.activa || !CUENTA.admin) {
    llenar(raiz, h("div", { class: "cabecera-vista" }, h("h2", null, "Administración"),
      h("p", { class: "error", id: "admin-no", role: "alert" }, "No tienes acceso a esta sección."),
      h("p", null, h("a", { href: "#/yo" }, "Volver a Mi seguimiento"))));
    return;
  }
  const seccion = SECCIONES.some(([k]) => k === params.seccion) ? params.seccion : "usuarios";
  const cuerpo = h("div", { id: "admin-cuerpo" }, h("p", { class: "cargando" }, "Cargando…"));
  llenar(raiz,
    h("div", { class: "cabecera-vista" }, h("h2", null, "Administración"), h("p", null, h("a", { id: "adm-volver", href: "#/yo" }, "← Volver a Mi seguimiento"))),
    h("nav", { class: "admin-menu", "aria-label": "Secciones de administración" },
      SECCIONES.map(([k, t]) => h("a", { href: `#/admin?seccion=${k}&_sinfoco=1`, id: `adm-${k}`, class: "boton sec", "aria-current": k === seccion ? "page" : null }, t))),
    cuerpo);
  ({ usuarios, embudo, mensajes, pruebas, pdf })[seccion](cuerpo, params).catch((e) => {
    console.error(e);
    llenar(cuerpo, h("p", { class: "error", role: "alert", id: "adm-error" }, "No se pudo cargar esta sección: " + e.message));
  });
}

// ---------- Usuarios y pagos ----------
function chipPase(u) {
  if (!u.pase_tipo) return h("span", { class: "chip" }, "Sin pase");
  const t = `${TIPO_PASE[u.pase_tipo] || u.pase_tipo} · ${u.pase_vigente ? "hasta" : "caducó el"} ${fmtDMA(u.pase_expira)}`;
  return h("span", { class: "chip " + (u.pase_vigente ? "oro" : "") }, t);
}

async function usuarios(cuerpo) {
  const cifras = await adminResumen();
  const ctx = { desde: 0, sel: null, msg: "", confirmar: null, datos: { total: 0, filas: [] } };
  const busca = h("input", { type: "search", id: "adm-buscar", placeholder: "Correo o nombre", autocomplete: "off" });
  const zona = h("div", { id: "adm-tabla" });
  const cifra = (n, t, id) => h("div", { class: "cifra", id }, h("strong", null, miles(n)), h("span", null, t));

  async function cargar(reiniciar = false) {
    if (reiniciar) ctx.desde = 0;
    ctx.datos = await adminUsuarios(busca.value.trim(), ctx.desde, 50);
    pintar();
  }
  function pintar() {
    const { total, filas } = ctx.datos;
    llenar(zona,
      h("p", { class: "tenue peq", id: "adm-total" }, `${miles(total)} ${total === 1 ? "persona" : "personas"}${filas.length < total ? ` · mostrando de la ${ctx.desde + 1} a la ${ctx.desde + filas.length}` : ""}`),
      filas.length ? h("div", { class: "tabla-wrap" }, h("table", { class: "datos tabla-admin" },
        h("thead", null, h("tr", null, h("th", null, "Persona"), h("th", null, "Alta"), h("th", null, "Acceso"), h("th", { class: "num" }, "Invitadas"), h("th", null, ""))),
        h("tbody", null, filas.map((u) => filaUsuario(u, ctx, cargar, pintar)))))
        : h("p", { class: "vacio" }, "No hay nadie con ese correo o nombre."),
      h("div", { class: "campos" },
        ctx.desde > 0 ? h("button", { type: "button", class: "boton sec", id: "adm-anterior", onclick: () => { ctx.desde = Math.max(0, ctx.desde - 50); cargar(); } }, "← Anteriores") : null,
        ctx.desde + filas.length < total ? h("button", { type: "button", class: "boton sec", id: "adm-siguiente", onclick: () => { ctx.desde += 50; cargar(); } }, "Siguientes →") : null));
  }

  llenar(cuerpo,
    h("div", { class: "bloque", id: "adm-usuarios" },
      h("h3", null, "Usuarios y pagos"),
      h("div", { class: "cifras" },
        cifra(cifras.cuentas, "personas han entrado", "c-cuentas"), cifra(cifras.hoy, "hoy", "c-hoy"), cifra(cifras.ultimos_7, "en 7 días", "c-7"),
        cifra(cifras.en_prueba, "en prueba", "c-prueba"), cifra(cifras.pagando, "con pase de pago", "c-pagando"),
        cifra(cifras.gratis_invitaciones, "gratis por invitar", "c-gratis"), cifra(cifras.regalados, "con pase regalado", "c-regalados"),
        cifra(cifras.sin_acceso, "sin acceso", "c-sin"), cifra(cifras.con_nombre, "con nombre guardado", "c-nombre")),
      h("p", { class: "tenue peq" }, "Elige una persona con «Gestionar» para ver su web (solo lectura), regalarle el pase, ampliar su prueba, anular sus pases o corregir su nombre. Todo queda anotado."),
      h("form", { class: "campos", onsubmit: (e) => { e.preventDefault(); cargar(true); } },
        h("label", null, "Buscar", busca), h("button", { type: "submit", class: "boton", id: "adm-buscar-go" }, "Buscar")),
      zona));
  await cargar();
}

function filaUsuario(u, ctx, recargar, pintar) {
  const abierto = ctx.sel === u.user_id;
  const filas = [h("tr", { class: abierto ? "sel" : "", "data-email": u.email },
    h("td", null, h("div", null, u.email), u.nombre ? h("div", { class: "tenue peq" }, u.nombre) : null),
    h("td", null, fmtDMA((u.alta || "").slice(0, 10))),
    h("td", null, chipPase(u)),
    h("td", { class: "num" }, String(u.invitados)),
    h("td", null, h("button", { type: "button", class: "boton sec chico", "data-gestionar": u.email,
      onclick: () => { ctx.sel = abierto ? null : u.user_id; ctx.msg = ""; ctx.confirmar = null; pintar(); } }, abierto ? "Cerrar" : "Gestionar")))];
  if (abierto) filas.push(h("tr", { class: "fila-acciones" }, h("td", { colspan: 5 }, panelAcciones(u, ctx, recargar, pintar))));
  return filas;
}

function panelAcciones(u, ctx, recargar, pintar) {
  const hacer = async (accion, valor, ok) => {
    try { const r = await adminAccion(u.user_id, accion, valor); ctx.msg = r === "ok" ? ok : (RESULTADO[r] || r); ctx.confirmar = null; await recargar(); }
    catch (e) { ctx.msg = "No se pudo: " + e.message; pintar(); }
  };
  const nombre = h("input", { type: "text", id: "adm-nombre-in", maxlength: 120, value: u.nombre || "", placeholder: "APELLIDOS, NOMBRE" });
  return h("div", { class: "panel-acciones", id: "adm-panel-acciones" },
    h("p", { class: "tenue peq" }, `Código de invitación ${u.codigo}${u.invitado_por ? ` · la invitó ${u.invitado_por}` : ""} · mensajes enviados: ${u.mensajes}`),
    h("div", { class: "campos" },
      h("button", { type: "button", class: "boton", id: "adm-ver-como-btn", onclick: async () => {
        try { await verComo(u.user_id); ir("yo"); } catch (e) { ctx.msg = "No se pudo: " + e.message; pintar(); }
      } }, "Ver la web como esta persona"),
      h("button", { type: "button", class: "boton sec", id: "adm-regalar", onclick: () => hacer("regalar", null, "Pase regalado hasta el 30/06.") }, "Regalar pase hasta 30/06"),
      h("button", { type: "button", class: "boton sec", id: "adm-ampliar", onclick: () => hacer("ampliar_prueba", "15", "Prueba ampliada 15 días.") }, "Ampliar prueba 15 días"),
      ctx.confirmar === "anular"
        ? [h("button", { type: "button", class: "boton", id: "adm-anular-si", onclick: () => hacer("anular", null, "Pases anulados.") }, "Sí, anular sus pases"),
          h("button", { type: "button", class: "boton sec", onclick: () => { ctx.confirmar = null; pintar(); } }, "No")]
        : h("button", { type: "button", class: "boton sec", id: "adm-anular", onclick: () => { ctx.confirmar = "anular"; pintar(); } }, "Anular sus pases")),
    h("form", { class: "campos", onsubmit: (e) => { e.preventDefault(); hacer("nombre", nombre.value, "Nombre corregido y límites reiniciados."); } },
      h("label", null, "Corregir su nombre en las listas", nombre), h("button", { type: "submit", class: "boton sec", id: "adm-nombre-go" }, "Guardar nombre")),
    ctx.msg ? h("p", { class: "tenue", id: "adm-msg", role: "status" }, ctx.msg) : null);
}

// ---------- Embudo ----------
async function embudo(cuerpo) {
  const pasos = await adminEmbudo();
  const max = Math.max(1, pasos[0]?.n || 1);
  llenar(cuerpo, h("div", { class: "bloque", id: "adm-embudo" },
    h("h3", null, "Embudo: registro → prueba → pago"),
    h("p", { class: "tenue peq" }, "Sin visitas a la web: solo cuenta lo que hay en la base de datos."),
    pasos.map((p, i) => h("div", { class: "paso-embudo", "data-paso": String(i) },
      h("div", { class: "paso-t" }, h("span", null, p.etapa), h("strong", null, miles(p.n)),
        i ? h("span", { class: "tenue peq" }, `${pct(p.n, pasos[i - 1].n)} del paso anterior · ${pct(p.n, pasos[0].n)} del total`) : null),
      h("div", { class: "barra-embudo" }, h("span", { style: `width:${((p.n / max) * 100).toFixed(1)}%` })))),
    h("p", { class: "tenue peq" }, "La app gratis por invitar no cuenta como pago. «Usaron Mi seguimiento» = tienen guardada al menos una lista o un destino.")));
}

// ---------- Sugerencias y reclamaciones ----------
async function mensajes(cuerpo) {
  let filtro = "";
  async function pintar() {
    const ms = await adminMensajes(filtro || null);
    llenar(cuerpo, h("div", { class: "bloque", id: "adm-mensajes" },
      h("h3", null, "Sugerencias y reclamaciones"),
      segmento([["", "Todos"], ["nuevo", "Nuevos"], ["visto", "Vistos"], ["resuelto", "Resueltos"]], filtro, (v) => { filtro = v; pintar(); }, "Filtrar mensajes"),
      ms.length ? ms.map((m) => tarjetaMensaje(m, pintar)) : h("p", { class: "vacio", id: "adm-sin-mensajes" }, "No hay mensajes.")));
  }
  await pintar();
}

function tarjetaMensaje(m, recargar) {
  const respuesta = h("textarea", { rows: 2, maxlength: 2000, id: `adm-resp-${m.id}`, placeholder: "Respuesta (la verá la persona en Ajustes)" });
  const guardar = (estado) => async () => { await adminResponder(m.id, estado, respuesta.value); recargar(); };
  return h("article", { class: "mensaje-admin", "data-id": String(m.id) },
    h("div", null, h("span", { class: "chip " + (m.tipo === "reclamacion" ? "rojo" : "") }, m.tipo === "reclamacion" ? "Reclamación" : "Sugerencia"), " ",
      h("strong", null, m.email), " ", h("span", { class: "tenue peq" }, `${fmtDMA((m.creado || "").slice(0, 10))} · ${m.estado}`)),
    h("p", null, m.texto),
    m.respuesta ? h("p", { class: "respuesta" }, h("strong", null, "Tu respuesta: "), m.respuesta) : null,
    respuesta,
    h("div", { class: "campos" },
      h("button", { type: "button", class: "boton", id: `adm-resolver-${m.id}`, onclick: guardar("resuelto") }, "Responder y marcar resuelto"),
      m.estado === "nuevo" ? h("button", { type: "button", class: "boton sec", id: `adm-visto-${m.id}`, onclick: guardar("visto") }, "Marcar visto") : null,
      m.estado === "resuelto" ? h("button", { type: "button", class: "boton sec", id: `adm-reabrir-${m.id}`, onclick: guardar("nuevo") }, "Reabrir") : null));
}

// ---------- Pruebas terminadas sin pagar ----------
async function pruebas(cuerpo) {
  let msg = "";
  async function pintar() {
    const filas = await adminPruebasTerminadas(22);
    const correos = filas.map((f) => f.email).join("; ");
    const hacer = (u, accion, valor, ok) => async () => { try { const r = await adminAccion(u.user_id, accion, valor); msg = r === "ok" ? `${u.email}: ${ok}` : (RESULTADO[r] || r); } catch (e) { msg = "No se pudo: " + e.message; } pintar(); };
    llenar(cuerpo, h("div", { class: "bloque", id: "adm-pruebas" },
      h("h3", null, "Pruebas terminadas sin pagar (22 días o más)"),
      h("p", { class: "tenue peq" }, "Cuentas creadas hace 22 días o más (15 de prueba y una semana de margen) que no han pagado, ni tienen app gratis ni pase regalado."),
      filas.length ? [
        h("div", { class: "campos" },
          h("button", { type: "button", class: "boton sec", id: "adm-copiar", onclick: async (e) => {
            try { await navigator.clipboard.writeText(correos); msg = `Copiados ${filas.length} correos.`; } catch (err) { msg = correos; }
            pintar();
          } }, "Copiar los correos"), h("span", { class: "tenue peq" }, `${miles(filas.length)} ${filas.length === 1 ? "persona" : "personas"}`)),
        h("div", { class: "tabla-wrap" }, h("table", { class: "datos tabla-admin", id: "adm-tabla-pruebas" },
          h("thead", null, h("tr", null, h("th", null, "Persona"), h("th", null, "Alta"), h("th", { class: "num" }, "Días"), h("th", null, "Prueba hasta"), h("th", null, ""))),
          h("tbody", null, filas.map((u) => h("tr", { "data-email": u.email },
            h("td", null, h("div", null, u.email), u.nombre ? h("div", { class: "tenue peq" }, u.nombre) : null),
            h("td", null, fmtDMA((u.alta || "").slice(0, 10))), h("td", { class: "num" }, String(u.dias)), h("td", null, fmtDMA(u.prueba_hasta)),
            h("td", null, h("div", { class: "campos", style: "margin:0" },
              h("button", { type: "button", class: "boton sec chico", "data-ampliar": u.email, onclick: hacer(u, "ampliar_prueba", "15", "prueba ampliada 15 días.") }, "Ampliar 15 días"),
              h("button", { type: "button", class: "boton sec chico", "data-regalar": u.email, onclick: hacer(u, "regalar", null, "pase regalado hasta el 30/06.") }, "Regalar pase")))))))),
      ] : h("p", { class: "vacio", id: "adm-sin-pruebas" }, "No hay nadie en esta situación."),
      msg ? h("p", { class: "tenue", id: "adm-msg", role: "status" }, msg) : null));
  }
  await pintar();
}

// ---------- Subir PDF ----------
async function pdf(cuerpo) {
  const entrada = h("input", { type: "file", id: "pdf-in", accept: "application/pdf,.pdf", multiple: true });
  const msg = h("p", { id: "pdf-msg", role: "status", class: "tenue" });
  const lista = h("div", { id: "pdf-lista" });
  const mostrar = (t, error) => { msg.textContent = t; msg.className = error ? "error-txt" : "tenue"; };
  async function recargar() {
    const fs = await adminListarPdf();
    llenar(lista, fs.length
      ? h("ul", { class: "pdfs" }, fs.map((f) => h("li", null, h("span", null, f.nombre), " ", h("span", { class: "tenue peq" }, `${Math.max(1, Math.round(f.bytes / 1024))} KB`), " ",
        h("button", { type: "button", class: "enlace", "data-borrar": f.nombre, onclick: async () => { if (await adminBorrarPdf(f.nombre)) recargar(); else mostrar("No se pudo borrar.", true); } }, "Quitar"))))
      : h("p", { class: "tenue peq", id: "pdf-vacio" }, "No hay PDF esperando."));
  }
  llenar(cuerpo, h("div", { class: "bloque", id: "adm-pdf" },
    h("h3", null, "Subir PDF"),
    h("p", null, "Sube aquí los PDF de Educaragón que el robot no haya podido bajar solo (ofertas, candidatos, adjudicadas). Se guardan en un espacio privado y el robot semanal los lee la próxima vez que se ejecute; después los borra."),
    h("p", { class: "tenue peq" }, "El robot se ejecuta solo de lunes a viernes por la tarde. Si no quieres esperar, ", h("a", { href: URL_ROBOT, target: "_blank", rel: "noopener", id: "pdf-robot" }, "ejecútalo a mano en GitHub"), " (Run workflow)."),
    h("form", { class: "campos", onsubmit: async (e) => {
      e.preventDefault();
      const fs = [...entrada.files];
      if (!fs.length) return mostrar("Elige uno o varios PDF.", true);
      const boton = e.target.querySelector("button[type=submit]"); boton.disabled = true; mostrar("Subiendo…");
      const fallos = []; let bien = 0;
      for (const f of fs) { const r = await adminSubirPdf(f); if (r.ok) bien++; else fallos.push(r.mensaje); }
      boton.disabled = false; entrada.value = "";
      mostrar(`${bien ? `Subidos ${bien} PDF. ` : ""}${fallos.join(" ")}`.trim(), fallos.length > 0);
      recargar();
    } }, h("label", null, "PDF de Educaragón", entrada), h("button", { type: "submit", class: "boton", id: "pdf-subir" }, "Subir")),
    msg,
    h("h4", null, "Esperando al robot"), lista));
  await recargar();
}
