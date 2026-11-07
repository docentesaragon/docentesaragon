// «Ajustes y avisos» (se llega desde Mi seguimiento > Ajustes). Todas las cuentas ven lo mismo; la administradora ve además su bloque rojo.
import { h, llenar, fmtDMA } from "./util.js";
import { YO, guardarYo } from "./datos.js";
import { CUENTA, salir, borrarMisDatos, guardarNombre, ERRORES_NOMBRE, nombreValido, enviarMensaje, misMensajes, TEXTO_SYNC, guardarAvisos, puedeSeguir } from "./cuenta.js";
import { bloqueCasa } from "./casa.js";
import { estadoDispositivo, activarAvisos, desactivarAvisos } from "./avisos.js";
import { bloqueInvitar, textoPase } from "./yo.js";
import { ir } from "./ruta.js";

let confirmandoSeguimiento = false, confirmandoDatos = false, editandoNombre = false;     // editandoNombre: solo para añadir el nombre si aún no lo hay
let precarga = null;       // texto que llega al pulsar «Avisa a la administración» en Mi seguimiento: { tipo, texto }
let errorDatos = "";       // si falla «Eliminar mis datos»
let avisoNombre = "";      // «Nombre guardado.» tras añadirlo

export function ajustes(raiz, params = {}) {
  if (params.reclamar === "nombre") {
    const n = CUENTA.perfil?.nombre;
    precarga = { tipo: "reclamacion", texto: n ? `Mi nombre o mis listas no son correctos. Mi nombre en la web es «${n}» y debería ser: ` : "Mi nombre o mis listas no son correctos. " };
  }
  if (!CUENTA.activa || CUENTA.estado === "anonimo") {
    llenar(raiz, h("div", { class: "cabecera-vista" }, h("h2", null, "Ajustes y avisos"),
      h("p", { class: "tenue" }, "Entra en Mi seguimiento con tu cuenta para ver tus ajustes."),
      h("p", null, h("a", { class: "boton", id: "aj-entrar", href: "#/yo" }, "Ir a Mi seguimiento"))));
    return;
  }
  llenar(raiz,
    h("div", { class: "cabecera-vista" },
      h("h2", null, "Ajustes y avisos"),
      h("p", null, h("a", { id: "aj-volver", href: "#/yo" }, "← Volver a Mi seguimiento"))),
    bloqueCuenta(raiz),
    bloqueAvisos(raiz),
    bloqueInvitar(),
    bloqueMensajes(),
    CUENTA.admin ? bloqueAdmin() : null,
    bloqueDatos(raiz));
}

function bloqueCuenta(raiz) {
  const perfil = CUENTA.perfil || {};
  const error = h("p", { class: "error-txt", id: "aj-nom-error", role: "alert", hidden: true });
  const entrada = h("input", { type: "text", id: "aj-nom-in", maxlength: 120, autocomplete: "off", placeholder: "GARCÍA LÓPEZ, MARÍA", value: perfil.nombre || "" });
  // El nombre no se cambia desde aquí: solo se puede añadir si todavía no hay (si hay un error, se avisa a la administración).
  const nombre = !perfil.nombre && editandoNombre
    ? h("form", { id: "aj-nom-form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!nombreValido(entrada.value)) { error.textContent = ERRORES_NOMBRE.invalido; error.hidden = false; return; }
      const estado = await guardarNombre(entrada.value);
      if (estado !== "ok") { error.textContent = ERRORES_NOMBRE[estado] || ERRORES_NOMBRE.error; error.hidden = false; return; }
      editandoNombre = false; avisoNombre = "Nombre guardado. Vuelve a Mi seguimiento: tus listas se buscan solas."; ajustes(raiz);
    } },
    h("label", null, "Mi nombre en las listas", entrada),
    h("p", { class: "tenue peq" }, "Revísalo bien: después no se puede cambiar desde aquí, solo avisando a la administración."),
    h("div", { class: "campos" },
      h("button", { type: "submit", class: "boton", id: "aj-nom-guardar" }, "Guardar"),
      h("button", { type: "button", class: "boton sec", onclick: () => { editandoNombre = false; ajustes(raiz); } }, "Cancelar")),
    error)
    : h("div", null,
      h("p", null, "Mi nombre en las listas: ", perfil.nombre ? h("strong", { id: "aj-nombre" }, perfil.nombre) : h("span", { class: "tenue", id: "aj-nombre" }, "no lo has puesto"), " ",
        perfil.nombre ? null : h("button", { type: "button", class: "enlace", id: "aj-nom-cambiar", onclick: () => { editandoNombre = true; avisoNombre = ""; ajustes(raiz); } }, "Añadir")),
      perfil.nombre
        ? h("p", { class: "tenue peq", id: "aj-nom-ayuda" }, "Sirve para encontrar tus listas y especialidades automáticamente. No se puede cambiar desde aquí. Si no es correcto, ",
          h("a", { href: "#/ajustes?reclamar=nombre", id: "aj-nom-avisar" }, "avisa a la administración"), " y lo corregimos.")
        : h("p", { class: "tenue peq" }, "Sirve para encontrar tus listas y especialidades automáticamente. Solo lo usa tu cuenta y la administración puede verlo para ayudarte."),
      avisoNombre ? h("p", { class: "tenue", id: "aj-nom-ok", role: "status" }, avisoNombre) : null);
  return h("div", { class: "bloque", id: "aj-cuenta" },
    h("h3", null, "Mi cuenta"),
    h("p", null, "Correo: ", h("strong", { id: "aj-email" }, CUENTA.email || "tu cuenta")),
    h("p", null, "Acceso: ", CUENTA.pase ? h("span", { class: "chip oro", id: "aj-pase" }, textoPase()) : h("span", { class: "tenue", id: "aj-pase" }, "sin pase en vigor")),
    nombre,
    bloqueCasa({ solo: true }));
}

const ERRORES_AVISOS = {
  no_soportado: "Este navegador no puede recibir avisos. En el móvil, usa la app de Docentes Aragón o Chrome.",
  denegado: "No has dado permiso para las notificaciones. Si quieres recibirlas, permítelas en los ajustes del navegador o de la app y vuelve a pulsar el botón.",
  sin_clave: "Los avisos todavía no están listos en el servidor. Se activan en cuanto se ejecuta la próxima actualización semanal; inténtalo mañana.",
  error: "No se han podido activar los avisos. Inténtalo de nuevo.",
};
let mensajeAvisos = "";

function bloqueAvisos(raiz) {
  const perfil = CUENTA.perfil || {}, avisos = perfil.avisos || {}, n = perfil.dispositivos || 0;
  const cuerpo = h("div", { id: "aj-avisos-cuerpo" }, h("p", { class: "tenue", role: "status" }, "Comprobando este dispositivo…"));
  const msg = h("p", { class: "tenue peq", id: "avisos-msg", role: "status" }, mensajeAvisos); mensajeAvisos = "";    // el mensaje se enseña una sola vez
  estadoDispositivo().then((d) => {
    const boton = (texto, id, f) => h("button", { type: "button", class: "boton", id, onclick: async (e) => { e.target.disabled = true; await f(); ajustes(raiz); } }, texto);
    llenar(cuerpo,
      !d.soportado ? h("p", { id: "avisos-estado-disp" }, ERRORES_AVISOS.no_soportado)
        : d.suscrito && d.permiso === "granted"
          ? [h("p", { id: "avisos-estado-disp" }, h("span", { class: "chip oro" }, "Activados en este dispositivo")),
            h("div", { class: "campos" }, h("button", { type: "button", class: "boton sec", id: "avisos-desactivar", onclick: async (e) => { e.target.disabled = true; await desactivarAvisos(); mensajeAvisos = "Avisos desactivados en este dispositivo."; ajustes(raiz); } }, "Desactivar en este dispositivo"))]
          : d.permiso === "denied" ? h("p", { id: "avisos-estado-disp" }, ERRORES_AVISOS.denegado)
            : [h("p", { id: "avisos-estado-disp" }, "En este dispositivo todavía no recibes avisos."),
              h("div", { class: "campos" }, boton("Activar avisos en este dispositivo", "avisos-activar", async () => { const r = await activarAvisos(); mensajeAvisos = r === "ok" ? "Avisos activados en este dispositivo." : ERRORES_AVISOS[r] || ERRORES_AVISOS.error; }))]);
  });
  return h("div", { class: "bloque", id: "aj-avisos" },
    h("h3", null, "Avisos en la app"),
    h("p", null, "Elige qué quieres que te avisemos. Los avisos llegan al móvil, no por correo."),
    h("label", { class: "check" }, h("input", { type: "checkbox", id: "avisos-listas", checked: avisos.listas !== false, onchange: async (e) => {
      const hecho = await guardarAvisos({ listas: e.target.checked });
      mensajeAvisos = hecho ? (e.target.checked ? "Avisos de tus listas activados." : "Avisos de tus listas desactivados.") : "No se pudo guardar. Inténtalo de nuevo.";
      ajustes(raiz);
    } }), "Tus listas: cada semana, si la adjudicación llegó a tu posición"),
    h("label", { class: "check" }, h("input", { type: "checkbox", id: "avisos-favoritos", checked: avisos.favoritos !== false, onchange: async (e) => {
      const hecho = await guardarAvisos({ favoritos: e.target.checked });
      mensajeAvisos = hecho ? (e.target.checked ? "Avisos de favoritos activados." : "Avisos de favoritos desactivados.") : "No se pudo guardar. Inténtalo de nuevo.";
      ajustes(raiz);
    } }), "Centros favoritos: vacantes nuevas y adjudicaciones (la estrella de cada fila en Vacantes)"),
    cuerpo,
    msg,
    h("p", { class: "tenue peq", id: "avisos-info" },
      n ? `Tu cuenta tiene avisos activados en ${n === 1 ? "1 dispositivo" : n + " dispositivos"}. ` : "",
      "Los avisos se envían una vez cada día laborable por la tarde, cuando se actualizan los datos. ",
      puedeSeguir() ? "" : "Para recibirlos necesitas tu prueba gratuita o un pase en vigor. ",
      "Los avisos de tus listas salen de las listas que ya tienes en Mi seguimiento: solo te avisamos una vez por semana y lista."),
    h("p", { class: "tenue peq" }, "No enviamos avisos por correo: el correo solo se usa para entrar en tu cuenta."));
}

// ---------- sugerencias y reclamaciones ----------
const TEXTO_ESTADO = { nuevo: "enviado", visto: "visto", resuelto: "resuelto" };
const ERRORES_MENSAJE = { invalido: "Escribe al menos 5 caracteres.", limite: "Has enviado ya varios mensajes. Inténtalo de nuevo mañana.", error: "No se pudo enviar. Inténtalo de nuevo." };

function bloqueMensajes() {
  const tipo = h("select", { id: "msg-tipo" }, h("option", { value: "sugerencia" }, "Sugerencia"), h("option", { value: "reclamacion" }, "Reclamación"));
  const texto = h("textarea", { id: "msg-texto", rows: 4, maxlength: 2000, placeholder: "Cuéntanos qué te gustaría mejorar o qué ha ido mal" });
  const pre = precarga; precarga = null;     // llega desde «Avisa a la administración»: tipo y texto empezados, y el cursor listo para escribir
  if (pre) { tipo.value = pre.tipo; texto.value = pre.texto; setTimeout(() => { texto.scrollIntoView({ block: "center" }); texto.focus(); texto.setSelectionRange(texto.value.length, texto.value.length); }, 0); }
  const estado = h("p", { id: "msg-estado", class: "tenue", role: "status" });
  const lista = h("div", { id: "msg-lista" });
  const cargar = () => misMensajes().then((ms) => llenar(lista, ms.length
    ? h("ul", { class: "mensajes" }, ms.map((m) => h("li", { class: "mensaje" },
      h("div", null, h("span", { class: "chip" }, m.tipo === "reclamacion" ? "Reclamación" : "Sugerencia"), " ", h("span", { class: "tenue peq" }, `${fmtDMA((m.creado || "").slice(0, 10))} · ${TEXTO_ESTADO[m.estado] || m.estado}`)),
      h("p", null, m.texto),
      m.respuesta ? h("p", { class: "respuesta" }, h("strong", null, "Respuesta: "), m.respuesta) : null)))
    : h("p", { class: "tenue peq" }, "Todavía no has enviado ninguno.")));
  cargar();
  return h("form", { class: "bloque", id: "aj-mensajes", onsubmit: async (e) => {
    e.preventDefault();
    const boton = e.target.querySelector("button[type=submit]"); boton.disabled = true;
    const r = await enviarMensaje(tipo.value, texto.value);
    boton.disabled = false;
    if (r === "ok") { texto.value = ""; estado.textContent = "Enviado. Gracias: lo leerá la administración."; estado.className = "tenue"; cargar(); }
    else { estado.textContent = ERRORES_MENSAJE[r] || ERRORES_MENSAJE.error; estado.className = "error-txt"; }
  } },
  h("h3", null, "Sugerencias y reclamaciones"),
  h("p", { class: "tenue" }, "Si algo no sale bien (por ejemplo, tu posición o un dato de una semana) o se te ocurre una mejora, escríbelo aquí. Lo lee la administración y, si hace falta, te contesta en esta misma pantalla."),
  h("div", { class: "campos" }, h("label", null, "Tipo", tipo)),
  h("label", { class: "ancho" }, "Mensaje", texto),
  h("div", { class: "campos" }, h("button", { type: "submit", class: "boton", id: "msg-enviar" }, "Enviar")),
  estado, lista);
}

// ---------- solo administradora ----------
function bloqueAdmin() {
  return h("div", { class: "bloque solo-admin", id: "aj-admin" },
    h("h3", null, "Administrador"),
    h("p", { class: "tenue peq" }, "Solo lo ves tú. Lo que haces aquí sobre cuentas de otras personas queda anotado."),
    h("div", { class: "campos" },
      h("a", { class: "boton sec solo-admin", id: "admin-especialidades", href: "#/yo?manual=1" }, "Administrador: cambiar mis especialidades"),
      h("a", { class: "boton sec solo-admin", id: "admin-ver-como", href: "#/admin?seccion=usuarios" }, "Administrador: ver la web como otra persona"),
      h("a", { class: "boton sec solo-admin", id: "admin-panel", href: "#/admin" }, "Administración")));
}

// ---------- mis datos ----------
function bloqueDatos(raiz) {
  const sync = h("span", { id: "sync-estado", class: "peq tenue", role: "status" }, TEXTO_SYNC[CUENTA.sync] || "");
  const seguimiento = confirmandoSeguimiento
    ? h("div", { class: "campos" }, h("span", null, "¿Borrar tus listas y destinos?"),
      h("button", { type: "button", class: "boton", id: "borrar-si", onclick: () => { YO.listas = []; YO.destinos = []; guardarYo(); confirmandoSeguimiento = false; ajustes(raiz); } }, "Sí, borrar"),
      h("button", { type: "button", class: "boton sec", onclick: () => { confirmandoSeguimiento = false; ajustes(raiz); } }, "Cancelar"))
    : h("button", { type: "button", class: "boton sec", id: "borrar", onclick: () => { confirmandoSeguimiento = true; ajustes(raiz); } }, "Borrar mi seguimiento");
  const datos = confirmandoDatos
    ? h("div", { class: "campos" }, h("span", null, "Se borrarán tu pase, tu prueba, tu código de invitación, tu nombre, tus mensajes y tu seguimiento de Docentes Aragón. No se puede deshacer. Tu cuenta de acceso (correo y contraseña) no se toca, porque es compartida con otras webs. Si el pago sigue vigente en Google Play, «Restaurar compra» recupera el pase."),
      h("button", { type: "button", class: "boton", id: "cuenta-borrar-si", onclick: async () => {
        try { await borrarMisDatos(); confirmandoDatos = false; errorDatos = ""; ir("yo"); return; }
        catch (e) { errorDatos = e.message; }
        confirmandoDatos = false; ajustes(raiz);
      } }, "Sí, eliminar mis datos"),
      h("button", { type: "button", class: "boton sec", onclick: () => { confirmandoDatos = false; ajustes(raiz); } }, "Cancelar"))
    : h("button", { type: "button", class: "boton sec peligro", id: "cuenta-borrar", onclick: () => { confirmandoDatos = true; ajustes(raiz); } }, "Eliminar mis datos de Aragón");
  return h("div", { class: "bloque", id: "aj-datos" },
    h("h3", null, "Mis datos"),
    h("p", { class: "tenue peq" }, "Tu posición y tus destinos se guardan en tu cuenta, no en este navegador. ", sync),
    h("div", { class: "campos" }, seguimiento, datos),
    errorDatos ? h("p", { class: "error-txt", id: "aj-datos-error", role: "alert" }, errorDatos) : null,
    h("p", { class: "tenue peq", id: "aj-eliminar-cuenta" }, "¿Quieres eliminar también tu cuenta de acceso (correo y contraseña)? ", h("a", { href: "eliminar-cuenta.html" }, "Cómo eliminar mi cuenta"), "."),
    h("div", { class: "campos" }, h("button", { type: "button", class: "boton sec", id: "salir-ajustes", onclick: async () => { await salir(); ir("yo"); } }, "Cerrar sesión")));
}
