// Centros favoritos: se guardan en Mi seguimiento (YO.favoritos) y el robot semanal avisa cuando hay vacantes nuevas o adjudicaciones en ellos.
import { YO, guardarYo } from "./datos.js";

export const MAX_FAVORITOS = 100;
export const esFavorito = (cod) => YO.favoritos.some((f) => f.cod === cod);

/** Pone o quita el centro de esa vacante de los favoritos. Devuelve true si queda como favorito. */
export function alternarFavorito(v) {
  if (esFavorito(v.centro_cod)) { YO.favoritos = YO.favoritos.filter((f) => f.cod !== v.centro_cod); guardarYo(); return false; }
  if (YO.favoritos.length >= MAX_FAVORITOS) return false;
  // «desde»: solo se avisa de lo que se publique a partir de hoy (lo de antes ya lo ves en Vacantes)
  YO.favoritos.push({ cod: v.centro_cod, centro: v.centro, localidad: v.localidad, provincia: v.provincia || "", desde: new Date().toISOString().slice(0, 10) });
  guardarYo();
  return true;
}
export function quitarFavorito(cod) { YO.favoritos = YO.favoritos.filter((f) => f.cod !== cod); guardarYo(); }
