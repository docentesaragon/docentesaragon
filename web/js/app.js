// Arranque y navegación.
import { h, llenar, fmtLarga } from "./util.js";
import { D, cargarBase, cargarVacantes } from "./datos.js";
import { leerRuta, ir } from "./ruta.js";
import { semana } from "./semana.js";
import { historico } from "./historico.js";
import { vacantes } from "./vacantes.js";
import { mapa } from "./mapa.js";
import { yo } from "./yo.js";
import { iniciarCuenta } from "./cuenta.js";

const VISTAS = { semana, historico, vacantes, mapa, yo };
const NECESITA_VACANTES = new Set(["vacantes", "mapa", "yo"]);
const raiz = document.getElementById("vista");

async function pintar() {
  const { vista, params } = leerRuta();
  const nombre = VISTAS[vista] ? vista : "semana";
  document.querySelectorAll(".pestanas a").forEach((a) => {
    if (a.dataset.vista === nombre) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const selCurso = document.querySelector(".selector-curso");
  if (selCurso) selCurso.hidden = nombre === "yo";   // en Mi seguimiento el curso no se elige: el pase ya va por curso
  try {
    if (NECESITA_VACANTES.has(nombre) && D.vacantes._curso !== D.curso) {
      llenar(raiz, h("p", { class: "cargando" }, "Cargando vacantes…"));
      const v = await cargarVacantes(D.curso);
      v._curso = D.curso;
    }
    VISTAS[nombre](raiz, params);
  } catch (e) {
    console.error(e);
    llenar(raiz, h("div", { class: "error" }, h("strong", null, "No se han podido cargar los datos. "), `${e.message}. Recarga la página; si sigue igual, vuelve a intentarlo más tarde.`));
  }
  if (!params._sinfoco) window.scrollTo({ top: 0 });
}

async function arrancar() {
  try {
    await cargarBase();
  } catch (e) {
    console.error(e);
    llenar(raiz, h("div", { class: "error" }, h("strong", null, "No se han podido cargar los datos. "), `${e.message}. Si abres el fichero index.html con doble clic no funciona: usa «abrir_local.bat» o la dirección publicada de la web.`));
    return;
  }
  D.curso = D.cursos[0];
  await iniciarCuenta();   // si volvemos de Google, recoge la sesión; carga el pase y el seguimiento
  const sel = document.getElementById("curso");
  sel.replaceChildren(...D.cursos.map((c) => h("option", { value: c }, c.replace("-", "/20"))));
  sel.addEventListener("change", () => { D.curso = sel.value; D.vacantes = []; pintar(); });
  if (D.aviso) { const a = document.getElementById("aviso-datos"); a.textContent = D.aviso; a.hidden = false; }
  document.getElementById("pie-actualizado").textContent = `Datos hasta la oferta del ${fmtLarga(D.actos[0]?.fecha_oferta)}${D.modo === "estatico" ? " (copia guardada en la web)" : ""}.`;
  window.addEventListener("hashchange", pintar);
  pintar();
}
arrancar();
