// «Mi casa»: el municipio donde vive la persona (se pide al crear la cuenta). Sirve solo para calcular distancias en su pantalla.
import { h, llenar } from "./util.js";
import { CUENTA, guardarCasa } from "./cuenta.js";
import { selectorMunicipio } from "./distancia.js";

const ERRORES = { invalido: "Ese municipio no vale. Elige uno de la lista.", error: "No se pudo guardar. Inténtalo de nuevo." };

/** Bloque «Mi casa» con su propio estado (se repinta solo). `alCambiar` avisa a quien lo usa (para recalcular distancias, por ejemplo). */
export function bloqueCasa({ solo = false, alCambiar = null, ro = false, empezarEditando = false } = {}) {
  const caja = h("div", { class: solo ? "" : "bloque", id: "casa" });
  let editando = empezarEditando, mensaje = "";
  function pintar() {
    const casa = CUENTA.perfil?.casa || "";
    if (editando && !ro) {
      let elegido = "";
      const sel = selectorMunicipio({ id: "casa-in", valor: "", alElegir: (v) => { elegido = v; } });
      const error = h("p", { class: "error-txt", id: "casa-error", role: "alert", hidden: true });
      llenar(caja,
        solo ? null : h("h3", null, "Mi casa"),
        h("form", { id: "casa-form", novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          if (!elegido) { error.textContent = "Elige tu municipio de la lista: empieza a escribirlo y pulsa sobre él."; error.hidden = false; return; }
          e.target.querySelectorAll("button").forEach((b) => { b.disabled = true; });
          const r = await guardarCasa(elegido);
          if (r !== "ok") { e.target.querySelectorAll("button").forEach((b) => { b.disabled = false; }); error.textContent = ERRORES[r] || ERRORES.error; error.hidden = false; return; }
          editando = false; mensaje = "Municipio guardado."; pintar(); alCambiar?.();
        } },
        h("label", null, "Municipio donde vives", sel.el),
        h("div", { class: "campos" },
          h("button", { type: "submit", class: "boton", id: "casa-guardar" }, "Guardar"),
          h("button", { type: "button", class: "boton sec", id: "casa-cancelar", onclick: () => { editando = false; pintar(); } }, "Cancelar")),
        error));
      return;
    }
    llenar(caja,
      solo ? null : h("h3", null, "Mi casa"),
      h("p", null, solo ? "Mi casa: " : null, casa ? [h("strong", { id: "casa-valor" }, casa), " "] : [h("span", { class: "tenue", id: "casa-valor" }, "Todavía no has elegido tu municipio. "), " "],
        ro ? null : h("button", { type: "button", class: "enlace", id: "casa-cambiar", onclick: () => { editando = true; mensaje = ""; pintar(); } }, casa ? "Cambiar" : "Elegir mi municipio")),
      h("p", { class: "tenue peq" }, "Solo guardamos el municipio (no tu dirección). Sirve para decirte a cuántos kilómetros en línea recta está cada centro; lo ve solo tu cuenta."),
      mensaje ? h("p", { class: "tenue peq", id: "casa-ok", role: "status" }, mensaje) : null);
  }
  pintar();
  return caja;
}
