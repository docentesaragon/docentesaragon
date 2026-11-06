// Municipios de España (para elegir «dónde vives») y distancias en línea recta hasta los centros.
// Datos de municipios: countries-states-cities-database (ODbL), con las coordenadas de web/data/localidades.json en Aragón.
import { h, norm, bonito, localidadBonita, centroBonito } from "./util.js";
import { D } from "./datos.js";

let cache = null;
/** Carga (una sola vez) la lista de municipios: { lista: [{nombre, provincia, lat, lon, clave, buscar}], porClave: Map }. */
export function cargarMunicipios() {
  if (!cache) {
    cache = fetch("data/municipios.json").then((r) => { if (!r.ok) throw new Error(`No se encuentra data/municipios.json (${r.status})`); return r.json(); }).then((d) => {
      const lista = d.m.map(([nombre, p, lat, lon]) => ({ nombre, provincia: d.provincias[p], lat, lon, clave: `${nombre} (${d.provincias[p]})`, buscar: norm(nombre), aragon: ["Zaragoza", "Huesca", "Teruel"].includes(d.provincias[p]) }));
      return { lista, porClave: new Map(lista.map((m) => [m.clave, m])) };
    }).catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/** Municipios que encajan con lo escrito (sin tildes ni mayúsculas): primero los que empiezan así, luego los que lo contienen; en empate, los de Aragón primero. */
export function buscarMunicipios(datos, texto, max = 8) {
  const q = norm(texto).replace(/\s+/g, " ").trim();
  if (q.length < 2) return [];
  const puntos = [];
  for (const m of datos.lista) {
    const i = m.buscar.indexOf(q);
    if (i < 0) continue;
    const p = i === 0 ? 0 : (m.buscar[i - 1] === " " || m.buscar[i - 1] === "/" || m.buscar[i - 1] === "-") ? 1 : 2;
    puntos.push([p * 2 + (m.aragon ? 0 : 1), m.buscar.length, m]);
  }
  return puntos.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].nombre.localeCompare(b[2].nombre, "es")).slice(0, max).map((x) => x[2]);
}

/** Distancia en línea recta (km) entre dos puntos {lat, lon}. */
export function km(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}
export function textoKm(k) {
  if (k < 1) return "menos de 1 km";
  return k < 10 ? `${k.toFixed(1).replace(".", ",")} km` : `${Math.round(k).toLocaleString("es-ES")} km`;
}

/** Coordenadas de la localidad de un centro (las de web/data/localidades.json), o null. */
export function coordsLocalidad(localidad) {
  const l = D.locs[localidad];
  return l && l.lat != null && l.lon != null ? { lat: l.lat, lon: l.lon, aprox: !!l.aprox } : null;
}

/** «Utebo (Zaragoza)» -> «Utebo, Zaragoza, España» (para buscarlo en un mapa). */
export function casaParaMapa(casa) {
  const m = /^(.*)\s\(([^()]+)\)$/.exec(casa || "");
  return m ? `${m[1]}, ${m[2]}, España` : `${casa}, España`;
}
/** Enlaces «Cómo llegar»: Google Maps (por nombres) y OpenStreetMap (por coordenadas, si las hay). Solo se abren si la persona los pulsa. */
export function enlacesRuta({ casa, centro, localidad, provincia }, desde, hasta) {
  const destino = `${centroBonito(centro)}, ${localidadBonita(localidad)}, ${bonito(provincia || "")}, España`;
  const google = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(casaParaMapa(casa))}&destination=${encodeURIComponent(destino)}&travelmode=driving`;
  const osm = desde && hasta ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${desde.lat}%2C${desde.lon}%3B${hasta.lat}%2C${hasta.lon}` : null;
  return { google, osm };
}

/** Campo para elegir el municipio escribiendo y pulsando una de las sugerencias.
 *  Devuelve { el, valor(), texto() }: valor() = «Utebo (Zaragoza)» si ha elegido uno de la lista, o "" si no. */
export function selectorMunicipio({ id, valor = "", placeholder = "Escribe tu municipio", alElegir = null }) {
  let datos = null, elegido = valor || "", activo = -1, sugeridos = [];
  const entrada = h("input", { type: "text", id, autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list", "aria-controls": `${id}-lista`, placeholder, value: valor });
  const lista = h("ul", { id: `${id}-lista`, class: "sugerencias", role: "listbox", hidden: true });
  const estado = h("span", { class: "tenue peq", id: `${id}-estado`, role: "status" });
  const cerrar = () => { lista.hidden = true; entrada.setAttribute("aria-expanded", "false"); activo = -1; };
  const elegir = (m) => { elegido = m.clave; entrada.value = m.clave; cerrar(); alElegir?.(m.clave); };
  const pintar = () => {
    sugeridos = datos ? buscarMunicipios(datos, entrada.value) : [];
    lista.replaceChildren(...sugeridos.map((m, i) => h("li", { role: "option", id: `${id}-op${i}`, "aria-selected": String(i === activo), class: i === activo ? "activa" : "",
      onmousedown: (e) => { e.preventDefault(); elegir(m); } }, m.nombre, " ", h("span", { class: "tenue" }, `(${m.provincia})`))));
    const hay = sugeridos.length > 0;
    lista.hidden = !hay; entrada.setAttribute("aria-expanded", String(hay));
    if (activo >= 0) entrada.setAttribute("aria-activedescendant", `${id}-op${activo}`); else entrada.removeAttribute("aria-activedescendant");
    estado.textContent = entrada.value.trim().length >= 2 && !hay && !elegido ? "No encuentro ese municipio. Prueba con otra forma de escribirlo." : "";
  };
  entrada.addEventListener("input", () => { if (elegido) { elegido = ""; alElegir?.(""); } activo = -1; pintar(); });
  entrada.addEventListener("focus", () => { if (!elegido) pintar(); });
  entrada.addEventListener("blur", () => setTimeout(cerrar, 120));
  entrada.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && sugeridos.length) { e.preventDefault(); activo = (activo + 1) % sugeridos.length; pintar(); }
    else if (e.key === "ArrowUp" && sugeridos.length) { e.preventDefault(); activo = (activo - 1 + sugeridos.length) % sugeridos.length; pintar(); }
    else if (e.key === "Enter" && !lista.hidden && sugeridos.length) { e.preventDefault(); elegir(sugeridos[Math.max(activo, 0)]); }
    else if (e.key === "Escape") cerrar();
  });
  cargarMunicipios().then((d) => { datos = d; if (document.activeElement === entrada && !elegido) pintar(); }).catch(() => { estado.textContent = "No se ha podido cargar la lista de municipios. Recarga la página."; });
  return { el: h("div", { class: "selector-municipio" }, entrada, lista, estado), valor: () => elegido, texto: () => entrada.value.trim() };
}
