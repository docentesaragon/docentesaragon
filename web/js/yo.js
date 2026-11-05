// Sección "Mi seguimiento": tu posición en la lista y tus destinos preferidos.
// Con Supabase configurado es el área personal de pago (cuenta con correo y contraseña + pase hasta el 30/06); sin él, funciona en local para pruebas.
import { h, llenar, miles, fmtCorta, fmtDMA, claveDe, textoClave, localidadBonita, centroBonito, bonito } from "./util.js";
import { D, YO, guardarYo, nombreCuerpo, actosDe } from "./datos.js";
import { CUENTA, entrarConGoogle, entrarConCorreo, crearCuenta, recuperarContrasena, nuevaContrasena, salir, borrarMisDatos, pagoHecho, TEXTO_SYNC,
  diasDePrueba, misReferidos, usarCodigo, enlacesInvitar, codigoPendiente } from "./cuenta.js";
import { productoActual, cursoDeProducto, compraDisponible, precioEnPlay, comprarPase, restaurarCompra } from "./compra.js";
import { situacion, nombreEspBonito } from "./comun.js";
import { filtrar } from "./vacantes.js";
import { ir } from "./ruta.js";

const borrador = { cuerpo_cod: "0597", esp: "", lista: "1", fecha: "", bloque: "", orden: "" };
let confirmandoBorrado = false;
let verCompra = false;     // true si quien está en prueba (o ya tiene pase) ha pulsado «Activar mi pase»

export function yo(raiz) {
  if (!CUENTA.activa) return seguimiento(raiz);               // modo de prueba, sin cuenta
  if (CUENTA.recuperando && CUENTA.estado !== "anonimo") return pantallaEntrada(raiz, "nueva");   // llegó desde el enlace de «he olvidado mi contraseña»
  if (CUENTA.estado === "anonimo") return pantallaEntrada(raiz);
  if (CUENTA.estado === "sin_pase" || verCompra) return pantallaPase(raiz);
  return seguimiento(raiz);
}

function seguimiento(raiz) {
  const cuerposConDatos = [...new Set(D.ultimo.map((u) => u.cuerpo_cod))].sort();
  if (!cuerposConDatos.includes(borrador.cuerpo_cod)) borrador.cuerpo_cod = cuerposConDatos[0];
  const espDe = (cod) => [...new Set(D.ultimo.filter((u) => u.cuerpo_cod === cod && (u.convocados || u.clave_ultimo)).map((u) => u.esp))]
    .map((e) => [e, `${e}: ${nombreEspBonito(cod, e)}`]).sort((a, b) => a[1].localeCompare(b[1], "es"));
  const opcEsp = espDe(borrador.cuerpo_cod);
  if (!opcEsp.some(([e]) => e === borrador.esp)) borrador.esp = opcEsp[0]?.[0] || "";

  const error = h("p", { class: "error", id: "yo-error", hidden: true, role: "alert" });
  const campo = (etiqueta, el) => h("label", null, etiqueta, el);
  const formulario = h("form", { class: "bloque", id: "form-lista", onsubmit: (e) => {
    e.preventDefault();
    const clave = claveDe({ lista: borrador.lista, fecha: borrador.fecha, bloque: borrador.bloque, orden: borrador.orden });
    if (!clave || !borrador.esp) { error.textContent = "Rellena todos los campos: lista, fecha del bloque, bloque y orden."; error.hidden = false; return; }
    YO.listas = YO.listas.filter((l) => !(l.cuerpo_cod === borrador.cuerpo_cod && l.esp === borrador.esp));
    YO.listas.push({ cuerpo_cod: borrador.cuerpo_cod, esp: borrador.esp, lista: +borrador.lista, fecha: borrador.fecha, bloque: +borrador.bloque, orden: +borrador.orden, clave });
    guardarYo(); Object.assign(borrador, { fecha: "", bloque: "", orden: "" }); yo(raiz);
  } },
  h("h3", null, "Añadir mi posición en una lista"),
  h("details", { class: "ayuda" }, h("summary", null, "¿Dónde encuentro estos datos?"),
    h("p", null, "En cualquier PDF «Candidatos por especialidad» de Educaragón, en la fila con tu nombre y la especialidad que quieras seguir: copia las columnas LISTA, FECHA, BLOQUE y ORDEN BLOQUE. No uses la columna RELACIÓN: cambia cada semana. Tu posición real no cambia de una semana a otra, por eso sirve para seguirte.")),
  h("div", { class: "campos" },
    campo("Cuerpo", h("select", { id: "y-cuerpo", onchange: (e) => { borrador.cuerpo_cod = e.target.value; yo(raiz); } }, cuerposConDatos.map((c) => h("option", { value: c, selected: c === borrador.cuerpo_cod }, bonito(nombreCuerpo(c)))))),
    campo("Especialidad", h("select", { id: "y-esp", onchange: (e) => { borrador.esp = e.target.value; } }, opcEsp.map(([v, t]) => h("option", { value: v, selected: v === borrador.esp }, t)))),
    campo("Lista", h("select", { id: "y-lista", onchange: (e) => { borrador.lista = e.target.value; } }, ["1", "2"].map((v) => h("option", { value: v, selected: v === borrador.lista }, v)))),
    campo("Fecha del bloque", h("input", { type: "date", id: "y-fecha", value: borrador.fecha, onchange: (e) => { borrador.fecha = e.target.value; } })),
    campo("Bloque", h("input", { type: "number", id: "y-bloque", min: 1, value: borrador.bloque, oninput: (e) => { borrador.bloque = e.target.value; } })),
    campo("Orden en el bloque", h("input", { type: "number", id: "y-orden", min: 1, value: borrador.orden, oninput: (e) => { borrador.orden = e.target.value; } })),
    h("button", { type: "submit", class: "boton", id: "y-anadir" }, "Guardar")),
  error);

  const seguimientos = YO.listas.map((l) => bloqueLista(l, raiz));
  llenar(raiz, 
    h("div", { class: "cabecera-vista" }, h("h2", null, "Mi seguimiento"),
      h("p", { class: "tenue" }, CUENTA.activa
        ? "Compara tu posición en la lista con hasta dónde llegó cada semana. Lo que apuntes aquí se guarda en tu cuenta y solo lo ves tú. La web no te pide nombre ni DNI."
        : "Compara tu posición en la lista con hasta dónde llegó cada semana. Lo que escribas aquí se guarda solo en este navegador: no se envía a ningún sitio y la web no te pide nombre ni DNI.")),
    CUENTA.activa ? [mensajeCuenta(), barraCuenta(raiz), avisoDeAcceso(raiz)] : null,
    h("div", { class: "dos-col" }, h("div", null, formulario, seguimientos.length ? seguimientos : h("p", { class: "vacio" }, "Todavía no has añadido ninguna lista.")), h("div", null, destinos(raiz))),
    CUENTA.activa ? bloqueInvitar() : null,
    borrado(raiz));
}

function bloqueLista(l, raiz) {
  const actos = actosDe(D.curso, l.cuerpo_cod === "0597" ? "maestros" : "secundaria").sort((a, b) => (a.fecha_oferta < b.fecha_oferta ? 1 : -1));
  const filas = actos.map((a) => ({ a, u: (D.ultimoPorActo.get(a.acto) || []).find((x) => x.cuerpo_cod === l.cuerpo_cod && x.esp === l.esp && (x.convocados || x.clave_ultimo)) })).filter((x) => x.u);
  const sits = filas.map((x) => ({ ...x, sit: situacion(l.clave, x.u) }));
  const alcanzada = sits.filter((x) => x.sit.cod === "alcanzada").length;
  const ultima = sits[0];
  const resumen = !sits.length
    ? "Todavía no hay semanas con lista para esta especialidad en este curso."
    : `En ${alcanzada} de ${sits.length} semanas con lista, la adjudicación llegó a tu posición. ${ultima ? `La más reciente (${fmtCorta(ultima.a.fecha_oferta)}): ${ultima.sit.texto.toLowerCase()}.` : ""}`;
  return h("div", { class: "bloque", "data-lista": `${l.cuerpo_cod}|${l.esp}` },
    h("div", { class: "campos", style: "justify-content:space-between;align-items:start;margin-top:0" },
      h("div", null, h("h3", null, `${l.esp}: ${nombreEspBonito(l.cuerpo_cod, l.esp)}`), h("p", { class: "tenue peq", style: "margin:0" }, `Tu posición: ${textoClave(l.clave)}`)),
      h("button", { type: "button", class: "boton sec", onclick: () => { YO.listas = YO.listas.filter((x) => x !== l); guardarYo(); yo(raiz); } }, "Quitar")),
    h("p", { class: "resumen-frase situacion" }, resumen),
    sits.length ? h("div", { class: "tabla-wrap" }, h("table", { class: "datos" },
      h("thead", null, h("tr", null, h("th", null, "Oferta"), h("th", { class: "num" }, "Último llamado"), h("th", null, "Tu situación"))),
      h("tbody", null, sits.slice(0, 12).map(({ a, u, sit }) => h("tr", null,
        h("td", null, fmtDMA(a.fecha_oferta)),
        h("td", { class: "num" }, u.relacion_ultimo ? `n.º ${miles(u.relacion_ultimo)} de ${miles(u.convocados)}` : u.reconstruido ? "Calculado con otras semanas" : `Ninguno (${miles(u.convocados)} convocados)`),
        h("td", { class: sit.cod === "alcanzada" ? "sit-tocaba situacion" : "" }, sit.texto)))))) : null,
    sits.length > 12 ? h("p", { class: "tenue peq" }, `Hay ${sits.length - 12} semanas más; están en la sección Histórico.`) : null,
    h("p", { class: "peq" }, h("a", { href: `#/historico?esp=${encodeURIComponent(l.cuerpo_cod + "|" + l.esp)}` }, "Ver gráfico del histórico")),
    h("p", { class: "tenue peq" }, "Orientativo: depende de quién estuviera disponible cada semana y de las vacantes que hubiera en las provincias que tú pidieras."));
}

function destinos(raiz) {
  const locs = Object.values(D.locs).map((x) => x.localidad).sort((a, b) => a.localeCompare(b, "es"));
  const entrada = h("input", { type: "text", id: "d-loc", list: "d-lista", placeholder: "Escribe una localidad" });
  const anadir = () => {
    const v = entrada.value.trim().toLowerCase();
    const loc = locs.find((l) => localidadBonita(l).toLowerCase() === v || l.toLowerCase() === v);
    if (loc && !YO.destinos.includes(loc)) { YO.destinos.push(loc); guardarYo(); yo(raiz); }
  };
  const recientes = D.vacantes.length ? filtrar({ cuerpo: "todos", semana: "ult1", prov: "", loc: "", centro: "", esp: "", estado: "todas", jornada: "", duracion: "", tipo: "todas", mis: true }) : [];
  return h("div", { class: "bloque", id: "destinos" },
    h("h3", null, "Mis destinos preferidos"),
    h("p", { class: "tenue peq" }, "Se resaltan en la tabla de vacantes y puedes filtrar por ellos."),
    h("div", { class: "campos" }, h("label", null, "Añadir localidad", entrada), h("datalist", { id: "d-lista" }, locs.map((l) => h("option", { value: localidadBonita(l) }))),
      h("button", { type: "button", class: "boton", id: "d-anadir", onclick: anadir }, "Añadir")),
    h("div", { class: "etiquetas" }, YO.destinos.length ? YO.destinos.map((l) => h("span", { class: "chip oro" }, localidadBonita(l),
      h("button", { type: "button", "aria-label": `Quitar ${localidadBonita(l)}`, onclick: () => { YO.destinos = YO.destinos.filter((x) => x !== l); guardarYo(); yo(raiz); } }, "×"))) : h("span", { class: "tenue peq" }, "Aún no has elegido ninguno. También puedes añadirlos desde el mapa.")),
    YO.destinos.length ? [
      h("h3", { style: "margin-top:1rem" }, "Última semana en tus destinos"),
      recientes.length ? h("ul", { style: "padding-left:1.1rem" }, recientes.slice(0, 10).map((v) => h("li", null,
        `${v.esp}, ${centroBonito(v.centro)} en ${localidadBonita(v.localidad)}: ${v.estado === "adjudicada" ? "adjudicada" : "sin adjudicar"}`)))
        : h("p", { class: "tenue" }, "No hubo vacantes en tus destinos en la última semana."),
      h("button", { type: "button", class: "boton sec", onclick: () => ir("vacantes", { mis: "1", cuerpo: "todos", semana: "todo" }) }, "Ver todas en el curso")] : null);
}

let confirmandoCuenta = false;
function borrado(raiz) {
  const sync = h("span", { id: "sync-estado", class: "peq tenue", role: "status" }, TEXTO_SYNC[CUENTA.sync] || "");
  const borrarTodo = confirmandoBorrado
    ? h("div", { class: "campos" }, h("span", null, "¿Borrar todo lo guardado?"),
      h("button", { type: "button", class: "boton", id: "borrar-si", onclick: () => { YO.listas = []; YO.destinos = []; guardarYo(); confirmandoBorrado = false; yo(raiz); } }, "Sí, borrar"),
      h("button", { type: "button", class: "boton sec", onclick: () => { confirmandoBorrado = false; yo(raiz); } }, "Cancelar"))
    : h("button", { type: "button", class: "boton sec", id: "borrar", onclick: () => { confirmandoBorrado = true; yo(raiz); } }, CUENTA.activa ? "Borrar mi seguimiento" : "Borrar mis datos");
  if (!CUENTA.activa) {
    return h("div", { class: "bloque" }, h("h3", null, "Mis datos"),
      h("p", { class: "tenue peq" }, "Tu posición y tus destinos viven en el almacenamiento de este navegador. Si borras los datos del navegador, desaparecen."), borrarTodo);
  }
  const cuenta = confirmandoCuenta
    ? h("div", { class: "campos" }, h("span", null, "Se borrarán tu pase, tu prueba, tu código de invitación y tu seguimiento de Docentes Aragón. No se puede deshacer. Si el pago sigue vigente en Google Play, «Restaurar compra» recupera el pase."),
      h("button", { type: "button", class: "boton", id: "cuenta-borrar-si", onclick: async () => {
        try { await borrarMisDatos(); } catch (e) { CUENTA.mensaje = e.message; }
        confirmandoCuenta = false; yo(raiz);
      } }, "Sí, borrar mis datos"),
      h("button", { type: "button", class: "boton sec", onclick: () => { confirmandoCuenta = false; yo(raiz); } }, "Cancelar"))
    : h("button", { type: "button", class: "boton sec", id: "cuenta-borrar", onclick: () => { confirmandoCuenta = true; yo(raiz); } }, "Borrar mi pase y mis datos");
  return h("div", { class: "bloque" }, h("h3", null, "Mis datos"),
    h("p", { class: "tenue peq" }, "Tu posición y tus destinos se guardan en tu cuenta, no en este navegador. ", sync),
    h("div", { class: "campos" }, borrarTodo, cuenta));
}

// ---------- cuenta y pase ----------
function barraCuenta(raiz) {
  return h("div", { class: "barra-cuenta" },
    h("span", null, "Sesión de ", h("strong", { id: "cuenta-email" }, CUENTA.email || "tu cuenta")),
    CUENTA.pase ? h("span", { class: "chip oro", id: "pase-activo" }, textoPase()) : null,
    h("button", { type: "button", class: "boton sec", id: "salir", onclick: async () => { await salir(); yo(raiz); } }, "Cerrar sesión"));
}

function textoPase() {
  const p = CUENTA.pase;
  if (p.tipo === "prueba") { const n = diasDePrueba(); return `Prueba gratuita: ${n === 1 ? "1 día" : n + " días"}`; }
  if (p.tipo === "invitaciones") return `App gratis hasta el ${fmtDMA(p.expira)}`;
  return `Pase activo hasta el ${fmtDMA(p.expira)}`;
}

/** Aviso de arriba en Mi seguimiento: días de prueba que quedan, o app gratis por invitar. */
function avisoDeAcceso(raiz) {
  const p = CUENTA.pase, cfg = window.CONFIG || {}, prod = productoActual(), info = cursoDeProducto(prod);
  if (!p) return null;
  if (p.tipo === "prueba") {
    const n = diasDePrueba();
    return h("div", { class: "aviso-acceso", id: "aviso-prueba" },
      h("div", null, h("strong", null, `Prueba gratuita: ${n === 1 ? "te queda 1 día" : `te quedan ${n} días`}`),
        h("p", null, "Después, ", precioTexto(prod), info ? ` por todo el curso (hasta el ${info.hasta}).` : ".", " Pago único, sin renovación automática.")),
      h("button", { type: "button", class: "boton", id: "activar-pase", onclick: () => { verCompra = true; yo(raiz); } }, `Activar mi pase`));
  }
  if (p.tipo === "invitaciones") {
    return h("div", { class: "aviso-acceso ok", id: "aviso-gratis" },
      h("div", null, h("strong", null, "Tienes la app gratis este curso"), h("p", null, `Gracias por invitar a 3 personas. Acceso hasta el ${fmtDMA(p.expira)}.`)));
  }
  return null;
}

// ---------- invitar: «Invita y consigue la app gratis» ----------
function bloqueInvitar() {
  const caja = h("div", { class: "bloque invitar", id: "invitar" }, h("h3", null, "Invita y consigue la app gratis"), h("p", { class: "tenue", id: "ref-carga" }, "Cargando…"));
  misReferidos().then((d) => {
    if (!d) { caja.querySelector("#ref-carga").textContent = "No disponible en este momento."; return; }
    const { texto, wa, tg } = enlacesInvitar(d.codigo);
    const msg = h("p", { class: "tenue peq", id: "ref-msg", role: "status" });
    const entrada = h("input", { type: "text", id: "ref-in", maxlength: 16, placeholder: "ARA-XXXXX", autocomplete: "off", value: codigoPendiente() });
    const usar = d.puede_usar ? h("div", { class: "campos" },
      h("label", null, "¿Te invitó alguien? Su código", entrada),
      h("button", { type: "button", class: "boton sec", id: "ref-usar", onclick: async () => {
        const r = await usarCodigo(entrada.value);
        msg.textContent = r.mensaje; msg.className = r.ok ? "tenue peq" : "error-txt peq";
        if (r.ok) llenarInvitar(caja, { ...d, usado: true, puede_usar: false }, msg, wa, tg, texto);
      } }, "Usar código")) : null;
    llenarInvitar(caja, d, msg, wa, tg, texto, usar);
  });
  return caja;
}
function llenarInvitar(caja, d, msg, wa, tg, texto, usar) {
  llenar(caja,
    h("h3", null, "Invita y consigue la app gratis"),
    h("p", null, `Si ${d.necesarios} personas se registran con tu código y pagan, tu curso es gratis.`),
    h("div", { class: "codigo-invitacion", id: "ref-codigo" }, d.codigo),
    h("p", { id: "ref-cuenta" }, "Invitados: ", h("strong", null, String(d.invitados)), " · han pagado: ", h("strong", null, `${d.pagados} de ${d.necesarios}`),
      d.gratis ? " · ¡Conseguido! Tienes la app gratis este curso." : ""),
    h("div", { class: "campos compartir" },
      h("a", { class: "boton", id: "ref-wa", href: wa, target: "_blank", rel: "noopener" }, "WhatsApp"),
      h("a", { class: "boton", id: "ref-tg", href: tg, target: "_blank", rel: "noopener" }, "Telegram"),
      navigator.share ? h("button", { type: "button", class: "boton sec", id: "ref-share", onclick: async () => { try { await navigator.share({ text: texto }); } catch (e) { /* cancelado */ } } }, "Otras apps…") : null,
      h("button", { type: "button", class: "enlace", id: "ref-copiar", onclick: async () => {
        try { await navigator.clipboard.writeText(texto); msg.textContent = "Mensaje copiado: pégalo donde quieras."; } catch (e) { msg.textContent = texto; }
        msg.className = "tenue peq";
      } }, "Copiar mensaje")),
    usar, msg);
}

function cabeceraAcceso() {
  return h("div", { class: "cabecera-vista" }, h("h2", null, "Mi seguimiento"),
    h("p", { class: "tenue" }, "Consultar las adjudicaciones es gratis. Mi seguimiento es tu área personal: apunta tu posición en las listas y tus destinos preferidos, y la web los compara cada semana con lo que se adjudica."));
}
function mensajeCuenta() {
  const m = CUENTA.mensaje; CUENTA.mensaje = "";
  return m ? h("p", { class: "error", role: "alert", id: "cuenta-mensaje" }, m) : null;
}
function precioTexto(prod) {
  const cfg = window.CONFIG || {};
  const el = h("strong", { id: "precio" }, cfg.precio || "7,49 €");
  if (compraDisponible()) precioEnPlay(prod).then((p) => { if (p) el.textContent = p; });
  return el;
}

// Entrada con correo y contraseña, con los mismos modos y textos que DocentsCV: entrar, crear cuenta, recuperar contraseña y nueva contraseña.
const MODOS = {   // título, botón, texto del enlace alternativo, modo al que lleva ese enlace
  login: ["Entrar", "Entrar", "Crear cuenta", "registro"],
  registro: ["Crear cuenta", "Crear cuenta", "Ya tengo cuenta", "login"],
  olvido: ["Recuperar contraseña", "Enviar enlace", "Volver", "login"],
  nueva: ["Nueva contraseña", "Guardar contraseña", "", "login"],
};
let modoAcceso = "login", correoEscrito = "";

function formularioAcceso(raiz, modo) {
  const cfg = window.CONFIG || {};
  const [titulo, boton, alterno, modoAlterno] = MODOS[modo];
  const msg = h("p", { id: "au-msg", role: "status", class: "tenue" });
  const mostrar = (t, error) => { msg.textContent = t; msg.className = error ? "error-txt" : "tenue"; };
  const mail = h("input", { type: "email", id: "au-mail", autocomplete: "username", value: correoEscrito, oninput: (e) => { correoEscrito = e.target.value; } });
  const pass = h("input", { type: "password", id: "au-pass", autocomplete: modo === "login" ? "current-password" : "new-password" });
  const acepto = h("input", { type: "checkbox", id: "au-ok" });
  const codigo = h("input", { type: "text", id: "au-ref", maxlength: 16, placeholder: "ARA-XXXXX", autocomplete: "off", value: codigoPendiente() });
  const ir = async (e) => {
    e.preventDefault();
    const correo = mail.value.trim(), clave = pass.value;
    if (modo !== "nueva" && !/^\S+@\S+\.\S+$/.test(correo)) return mostrar("Escribe un correo válido.", true);
    if (modo !== "olvido" && clave.length < 8) return mostrar("La contraseña debe tener al menos 8 caracteres.", true);
    if (modo === "registro" && !acepto.checked) return mostrar("Para crear la cuenta debes aceptar la política de privacidad y las condiciones.", true);
    mostrar("Un momento…");
    const botones = raiz.querySelectorAll("button"); botones.forEach((b) => { b.disabled = true; });
    let r;
    try {
      if (modo === "login") r = await entrarConCorreo(correo, clave);
      else if (modo === "registro") r = await crearCuenta(correo, clave, codigo.value);
      else if (modo === "olvido") r = await recuperarContrasena(correo);
      else r = await nuevaContrasena(clave);
    } catch (err) { r = { ok: false, mensaje: "Ha ocurrido un error. Inténtalo de nuevo." }; }
    botones.forEach((b) => { b.disabled = false; });
    if (!r.ok) return mostrar("No se pudo completar: " + r.mensaje, true);
    if (modo === "login" || modo === "nueva" || (modo === "registro" && r.sesion)) { pass.value = ""; yo(raiz); return; }
    pass.value = "";
    if (modo === "registro") {
      const otra = cfg.cuentaCompartidaCon;
      mostrar("Te hemos enviado un correo. Pulsa el enlace para confirmar tu cuenta y después entra." +
        (otra ? ` Si ya tienes cuenta en ${otra}, no llegará ningún correo: entra con tu correo y contraseña de siempre, o pulsa «He olvidado mi contraseña».` : ""));
    } else mostrar("Si el correo existe, recibirás un enlace para crear una nueva contraseña.");
  };
  const cambiar = (m) => () => { modoAcceso = m; yo(raiz); };
  const otra = cfg.cuentaCompartidaCon;
  return h("form", { class: "bloque form-acceso", id: "form-acceso", novalidate: true, onsubmit: ir },
    h("h3", { id: "au-title" }, titulo),
    modo !== "nueva" ? h("label", null, "Correo electrónico", mail) : null,
    modo !== "olvido" ? h("label", null, modo === "nueva" ? "Nueva contraseña (mínimo 8 caracteres)" : modo === "registro" ? "Contraseña (mínimo 8 caracteres)" : "Contraseña", pass) : null,
    modo === "registro" ? h("label", null, "Código de invitación (opcional)", codigo) : null,
    modo === "registro" ? h("label", { class: "check" }, acepto, h("span", null, "He leído la ", h("a", { href: "privacidad.html", target: "_blank", rel: "noopener" }, "política de privacidad y las condiciones"), " y las acepto.")) : null,
    h("div", { class: "campos" },
      h("button", { type: "submit", class: "boton", id: "au-go" }, boton),
      alterno ? h("button", { type: "button", class: "enlace", id: "au-alt", onclick: cambiar(modoAlterno) }, alterno) : null,
      modo === "login" ? h("button", { type: "button", class: "enlace", id: "au-forgot", onclick: cambiar("olvido") }, "He olvidado mi contraseña") : null),
    msg,
    (modo === "login" || modo === "registro") && otra ? h("p", { class: "tenue peq", id: "au-compartida" }, `¿Ya tienes cuenta en ${otra}? Es la misma: entra con tu correo y contraseña de ${otra}, no hace falta crear otra.`) : null,
    cfg.loginGoogle && (modo === "login" || modo === "registro") ? h("button", { type: "button", class: "boton sec", id: "entrar-google", onclick: entrarConGoogle }, "Entrar con Google") : null);
}

function pantallaEntrada(raiz, modo = modoAcceso) {
  if (CUENTA.recuperando && modo === "nueva") {
    llenar(raiz, cabeceraAcceso(), mensajeCuenta(), formularioAcceso(raiz, "nueva"));
    return;
  }
  const cfg = window.CONFIG || {}, dias = cfg.diasPrueba || 15;
  if (CUENTA.invitacion) { modo = modoAcceso = "registro"; CUENTA.invitacion = false; }   // llegó desde el enlace de una persona que la invita
  const prod = productoActual(), info = cursoDeProducto(prod);
  llenar(raiz, cabeceraAcceso(), mensajeCuenta(),
    h("div", { class: "bloque" },
      h("h3", null, "Qué incluye"),
      h("p", { class: "destacado", id: "prueba-gratis" }, h("strong", null, `Prueba gratis ${dias} días`), ": crea tu cuenta y empieza a seguir tus listas ahora mismo, sin pagar nada. ",
        codigoPendiente() ? "Te ha invitado una persona: tu código ya está puesto al crear la cuenta." : ""),
      h("ul", { class: "beneficios" },
        h("li", null, "Tu posición en cada lista, comparada con el último llamado de cada semana."),
        h("li", null, "Tus destinos preferidos, resaltados en Vacantes y en el Mapa."),
        h("li", null, "Tus datos en tu cuenta: los ves igual en el móvil y en el ordenador."),
        h("li", null, "Avisos desde la app: próximamente.")),
      h("p", null, "Pase del curso ", info ? info.curso : "", ": ", precioTexto(prod), info ? ` hasta el ${info.hasta}. Pago único, no se renueva solo.` : "."),
      h("p", { class: "tenue peq" }, "Guardamos tu correo, para identificar tu cuenta, y lo que apuntes aquí. Nunca te pedimos DNI ni tu nombre en las listas. Puedes borrar tu pase y tus datos cuando quieras.")),
    formularioAcceso(raiz, modo));
}

function pantallaPase(raiz) {
  const prod = productoActual(), info = cursoDeProducto(prod);
  const msg = h("p", { id: "compra-msg", role: "status", class: "tenue" });
  const mostrar = (texto, error) => { msg.textContent = texto; msg.className = error ? "error-txt" : "tenue"; };
  const ocupado = (v) => raiz.querySelectorAll("button").forEach((b) => { b.disabled = v; });
  const accion = (f) => async () => {
    ocupado(true);
    try { const r = await f(); if (r.cancelado) { mostrar(""); } else if (r.ok) { verCompra = false; yo(raiz); return; } else mostrar(r.mensaje, true); }
    catch (e) { mostrar("No se pudo completar la operación con Google Play. Inténtalo de nuevo.", true); }
    ocupado(false);
  };
  const caducado = CUENTA.ultimoPase && CUENTA.ultimoPase.expira < new Date().toISOString().slice(0, 10) ? CUENTA.ultimoPase : null;
  const pruebaTerminada = caducado && caducado.tipo === "prueba";
  llenar(raiz, cabeceraAcceso(), mensajeCuenta(), barraCuenta(raiz),
    h("div", { class: "bloque" },
      h("h3", { id: "pase-titulo" }, pruebaTerminada ? "Tu prueba gratuita ha terminado" : info ? `Activa tu pase del curso ${info.curso}` : "Activa tu pase"),
      pruebaTerminada ? h("p", null, `Para seguir viendo tu posición en las listas y tus destinos, activa tu pase${info ? ` del curso ${info.curso}` : ""}. Lo que guardaste sigue en tu cuenta y vuelve a verse al activarlo.`) : null,
      caducado && !pruebaTerminada ? h("p", { class: "tenue" }, `Tu pase anterior caducó el ${fmtDMA(caducado.expira)}. Lo que guardaste sigue en tu cuenta y vuelve a verse al activar el nuevo pase.`) : null,
      h("p", null, "Precio: ", precioTexto(prod), info ? `. Pago único, acceso hasta el ${info.hasta}; no se renueva solo.` : "."),
      compraDisponible()
        ? h("div", { class: "campos" },
          h("button", { type: "button", class: "boton", id: "comprar", onclick: accion(comprarPase) }, "Comprar con Google Play"),
          h("button", { type: "button", class: "boton sec", id: "restaurar", onclick: accion(restaurarCompra) }, "Restaurar compra"))
        : [h("p", null, "La compra se hace desde la app de Android de Docentes Aragón: entra en la app con el mismo correo y contraseña con los que has entrado aquí. Cuando la completes, vuelve a esta página."),
          h("button", { type: "button", class: "boton sec", id: "comprobar", onclick: accion(async () => { await pagoHecho(); return { ok: CUENTA.estado === "con_pase" && CUENTA.pase.tipo !== "prueba", mensaje: "Todavía no vemos ningún pase de pago en tu cuenta." }; }) }, "Ya he comprado: comprobar mi pase")],
      verCompra && CUENTA.estado === "con_pase" ? h("button", { type: "button", class: "enlace", id: "volver", onclick: () => { verCompra = false; yo(raiz); } }, "Volver a Mi seguimiento") : null,
      msg),
    bloqueInvitar());
}
