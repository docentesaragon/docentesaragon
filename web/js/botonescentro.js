// Botones de cada centro, compartidos por Vacantes y Semana: mapa (distancia desde tu casa) y favorito (el centro).
import { h, s, centroBonito, localidadBonita } from "./util.js";
import { puedeSeguir, CUENTA } from "./cuenta.js";
import { ir } from "./ruta.js";
import { esFavorito, alternarFavorito } from "./favoritos.js";

const ICONO = {
  mapa: "M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  estrella: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
};
const icono = (clave, relleno = false) => s("svg", { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true", fill: relleno ? "currentColor" : "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, s("path", { d: ICONO[clave] }));

/** v = { centro, centro_cod, localidad, provincia } */
export function botonMapa(v) {
  const nombre = centroBonito(v.centro);
  return h("button", { type: "button", class: "icono-boton mapa", title: "Distancia desde tu casa", "aria-label": `Ver a qué distancia está ${nombre} (${localidadBonita(v.localidad)})`,
    onclick: () => ir("yo", { lugar: v.localidad, centro: v.centro, cod: v.centro_cod || "", prov: v.provincia || "" }) }, icono("mapa"));
}

/** `alCambiar(texto)` se llama tras guardar o quitar el favorito, con el mensaje para enseñar; quien llama repinta sus botones. */
export function botonFavorito(v, alCambiar) {
  if (!v.centro_cod) return null;
  const nombre = centroBonito(v.centro), fav = esFavorito(v.centro_cod);
  return h("button", { type: "button", class: "icono-boton favorito" + (fav ? " activo" : ""), "aria-pressed": String(fav),
    title: fav ? "Quitar de favoritos" : "Guardar este centro en favoritos",
    "aria-label": fav ? `Quitar ${nombre} de mis favoritos` : `Guardar ${nombre} en mis favoritos y avisarme de novedades`,
    onclick: () => {
      if (!puedeSeguir()) { ir("yo"); return; }          // sin cuenta o sin pase: te lleva a Mi seguimiento para entrar
      const ahora = alternarFavorito(v);
      alCambiar(ahora
        ? `«${nombre}» guardado en Mi seguimiento. ${CUENTA.activa && !CUENTA.perfil?.dispositivos ? "Para que te avisemos en el móvil, activa los avisos en Ajustes." : "Te avisaremos cuando haya una vacante nueva o una adjudicación."}`
        : `«${nombre}» quitado de tus favoritos.`);
    } }, icono("estrella", fav));
}

/** Rellena el cuadro de aviso (#aviso-fav) con el texto y el enlace a Mi seguimiento. */
export function mostrarAvisoFav(texto) {
  const el = document.getElementById("aviso-fav"); if (!el) return;
  if (!texto) { el.hidden = true; return; }
  el.replaceChildren(texto + " ", h("a", { href: "#/yo", id: "ver-favoritos" }, "Ver mis favoritos"));
  el.hidden = false;
}
