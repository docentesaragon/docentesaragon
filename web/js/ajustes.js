// «Ajustes y avisos» (se llega desde Mi seguimiento > Ajustes). Todas las cuentas ven lo mismo; la administradora ve además su bloque rojo.
import { h, llenar, fmtDMA } from "./util.js";
import { YO, guardarYo } from "./datos.js";
import { CUENTA, salir, borrarMisDatos, guardarNombre, ERRORES_NOMBRE, nombreValido, enviarMensaje, misMensajes, TEXTO_SYNC } from "./cuenta.js";
import { bloqueInvitar, textoPase } from "./yo.js";
import { ir } from "./ruta.js";

let confirmandoSeguimiento = false, confirmandoDatos = false, editandoNombre = false;
let errorDatos = "";       // si falla «Eliminar mis datos»
let avisoNombre = "";      // «Nombre guardado.» tras cambiarlo

export function ajustes(raiz) {
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
    bloqueAvisos(),
    bloqueInvitar(),
    bloqueMensajes(),
    CUENTA.admin ? bloqueAdmin() : null,
    bloqueDatos(raiz));
}

function bloqueCuenta(raiz) {
  const perfil = CUENTA.perfil || {};
  const error = h("p", { class: "error-txt", id: "aj-nom-error", role: "alert", hidden: true });
  const entrada = h("input", { type: "text", id: "aj-nom-in", maxlength: 120, autocomplete: "off", placeholder: "GARCÍA LÓPEZ, MARÍA", value: perfil.nombre || "" });
  const sinCambios = perfil.cambios_restantes === 0;
  const nombre = editandoNombre
    ? h("form", { id: "aj-nom-form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!nombreValido(entrada.value)) { error.textContent = ERRORES_NOMBRE.invalido; error.hidden = false; return; }
      const estado = await guardarNombre(entrada.value);
      if (estado !== "ok") { error.textContent = ERRORES_NOMBRE[estado] || ERRORES_NOMBRE.error; error.hidden = false; return; }
      editandoNombre = false; avisoNombre = "Nombre guardado. Vuelve a Mi seguimiento y pulsa «Buscar mis listas»."; ajustes(raiz);
    } },
    h("label", null, "Mi nombre en las listas", entrada),
    h("div", { class: "campos" },
      h("button", { type: "submit", class: "boton", id: "aj-nom-guardar" }, "Guardar"),
      h("button", { type: "button", class: "boton sec", onclick: () => { editandoNombre = false; ajustes(raiz); } }, "Cancelar")),
    error)
    : h("div", null,
      h("p", null, "Mi nombre en las listas: ", perfil.nombre ? h("strong", { id: "aj-nombre" }, perfil.nombre) : h("span", { class: "tenue", id: "aj-nombre" }, "no lo has puesto"), " ",
        h("button", { type: "button", class: "enlace", id: "aj-nom-cambiar", disabled: sinCambios, onclick: () => { editandoNombre = true; avisoNombre = ""; ajustes(raiz); } }, perfil.nombre ? "Cambiar" : "Añadir")),
      h("p", { class: "tenue peq" }, sinCambios
        ? "Ya has cambiado el nombre 3 veces. Si necesitas cambiarlo otra vez, escríbenos en «Sugerencias y reclamaciones» y lo corregimos."
        : "Sirve para encontrar tus listas y especialidades automáticamente. Solo lo usa tu cuenta y la administración puede verlo para ayudarte."),
      avisoNombre ? h("p", { class: "tenue", id: "aj-nom-ok", role: "status" }, avisoNombre) : null);
  return h("div", { class: "bloque", id: "aj-cuenta" },
    h("h3", null, "Mi cuenta"),
    h("p", null, "Correo: ", h("strong", { id: "aj-email" }, CUENTA.email || "tu cuenta")),
    h("p", null, "Acceso: ", CUENTA.pase ? h("span", { class: "chip oro", id: "aj-pase" }, textoPase()) : h("span", { class: "tenue", id: "aj-pase" }, "sin pase en vigor")),
    nombre);
}

function bloqueAvisos() {
  return h("div", { class: "bloque", id: "aj-avisos" },
    h("h3", null, "Avisos"),
    h("p", null, "Todavía no hay avisos. Estamos preparando avisos en la app de Android para cuando se publique una adjudicación que te afecte (por ejemplo, que la lista llegue a tu posición)."),
    h("p", { class: "tenue peq" }, "No enviamos avisos por correo: el correo solo se usa para entrar en tu cuenta."));
}

// ---------- sugerencias y reclamaciones ----------
const TEXTO_ESTADO = { nuevo: "enviado", visto: "visto", resuelto: "resuelto" };
const ERRORES_MENSAJE = { invalido: "Escribe al menos 5 caracteres.", limite: "Has enviado ya varios mensajes. Inténtalo de nuevo mañana.", error: "No se pudo enviar. Inténtalo de nuevo." };

function bloqueMensajes() {
  const tipo = h("select", { id: "msg-tipo" }, h("option", { value: "sugerencia" }, "Sugerencia"), h("option", { value: "reclamacion" }, "Reclamación"));
  const texto = h("textarea", { id: "msg-texto", rows: 4, maxlength: 2000, placeholder: "Cuéntanos qué te gustaría mejorar o qué ha ido mal" });
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
    h("div", { class: "campos" }, h("button", { type: "button", class: "boton sec", id: "salir-ajustes", onclick: async () => { await salir(); ir("yo"); } }, "Cerrar sesión")));
}
