// Navegación por hash: #/vista?clave=valor
export function ir(vista, params = {}) {
  const q = new URLSearchParams(params).toString();
  location.hash = `#/${vista}${q ? "?" + q : ""}`;
}
export function leerRuta() {
  const [ruta, q] = location.hash.replace(/^#\/?/, "").split("?");
  return { vista: ruta || "semana", params: Object.fromEntries(new URLSearchParams(q || "")) };
}
