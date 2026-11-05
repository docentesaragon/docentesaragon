"""Pruebas de uso real con Playwright: filtros, mapa, seguimiento personal, localStorage. python3 interaccion.py URL CARPETA_CAPTURAS"""
import sys, json
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
fallos = []
def ok(c, msg):
    print(("OK   " if c else "FALLO ") + msg)
    if not c: fallos.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    errores = []
    pg.on("console", lambda m: errores.append(m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errores.append("PAGEERROR " + str(e)))
    pg.goto(url + "/index.html#/semana"); pg.wait_for_selector(".fila-esp")

    # --- Semana: cambiar a Secundaria, buscar, ordenar
    pg.click("text=Secundaria y otros"); pg.wait_for_selector(".fila-esp")
    n_sec = pg.locator(".fila-esp").count()
    ok(n_sec > 10, f"Secundaria muestra {n_sec} especialidades")
    pg.fill("#buscar-esp", "ingl")
    ok(0 < pg.locator(".fila-esp").count() < n_sec, "buscar 'ingl' filtra la lista")
    pg.fill("#buscar-esp", "")
    pg.click("text=Maestros")
    ok(pg.locator(".fila-esp").count() == 7, "Maestros vuelve a 7 especialidades")
    pg.click(".cab-lista button:has-text('Hasta dónde')")
    primera = pg.locator(".fila-esp .nombre").first.inner_text()
    ok("Inglés" in primera, f"orden por llegada pone Inglés arriba ({primera!r})")
    txt = pg.locator(".resumen-frase").inner_text()
    ok("ordinarias y se adjudicaron" in txt and "Quedó 1 sin adjudicar" in txt, f"frase resumen: {txt!r}")

    # --- Vacantes: filtros
    pg.goto(url + "/index.html#/vacantes"); pg.wait_for_selector("#tabla-vacantes")
    c0 = pg.locator("#contador").inner_text()
    pg.select_option("#f-prov", "TERUEL")
    c1 = pg.locator("#contador").inner_text()
    ok(c0 != c1 and "vacantes" in c1, f"filtro provincia cambia el contador: {c0!r} -> {c1!r}")
    celdas = pg.locator("#tabla-vacantes tbody tr td:nth-child(3) .peq").all_inner_texts()
    ok(all("(Teruel)" in c for c in celdas), f"todas las filas son de Teruel ({len(celdas)})")
    pg.select_option("#f-semana", "todo")
    pg.select_option("#f-estado", "sin")
    c2 = pg.locator("#contador").inner_text()
    ok("0 adjudicadas" in c2, f"estado 'sin adjudicar' deja 0 adjudicadas: {c2!r}")
    pg.click("#limpiar")
    pg.fill("#f-loc", "zaragoza")
    n = pg.locator("#tabla-vacantes tbody tr").count()
    ok(n > 0, f"localidad 'zaragoza' devuelve filas ({n})")
    with pg.expect_download() as d:
        pg.click("#csv")
    ruta = d.value.path(); cont = open(ruta, encoding="utf-8-sig").read().splitlines()
    ok(len(cont) > 1 and cont[0].startswith("Acto;Fecha"), f"CSV con {len(cont)-1} filas y cabecera correcta")
    ok("*" not in " ".join(cont[:50]), "el CSV no contiene NIF enmascarados")

    # --- Mapa
    pg.goto(url + "/index.html#/mapa"); pg.wait_for_selector("#mapa-svg .nube circle")
    nc = pg.locator("#mapa-svg .nube circle").count()
    ok(nc > 20, f"mapa dibuja {nc} círculos")
    pg.locator("#mapa-svg .nube circle").first.click()
    pg.wait_for_selector("#mapa-loc")
    ok("vacantes" in pg.locator("#mapa-panel").inner_text(), "panel del mapa muestra detalle al pulsar un círculo")
    vb0 = pg.get_attribute("#mapa-svg", "viewBox"); pg.click("#zoom-mas"); vb1 = pg.get_attribute("#mapa-svg", "viewBox")
    ok(vb0 != vb1, "el botón + acerca el mapa")
    pg.click("#destino"); ok("Quitar de mis destinos" in pg.locator("#destino").inner_text(), "añadir destino desde el mapa")
    pg.screenshot(path=f"{out}/mapa-seleccion.png")
    pg.click("#ver-vacantes"); pg.wait_for_selector("#tabla-vacantes")
    ok(pg.input_value("#f-loc") != "", f"'Ver estas vacantes' abre Vacantes filtrado por {pg.input_value('#f-loc')!r}")

    # --- Mi seguimiento
    pg.goto(url + "/index.html#/yo"); pg.wait_for_selector("#form-lista")
    pg.select_option("#y-esp", "AL")
    pg.select_option("#y-lista", "1"); pg.fill("#y-fecha", "2026-07-22"); pg.fill("#y-bloque", "32"); pg.fill("#y-orden", "15")
    pg.click("#y-anadir"); pg.wait_for_selector("[data-lista='0597|AL']")
    txt = pg.locator("[data-lista='0597|AL'] .resumen-frase").inner_text()
    ok("semanas con lista" in txt, f"resumen de seguimiento: {txt[:140]!r}")
    pg.screenshot(path=f"{out}/yo-con-datos.png", full_page=True)
    ls = pg.evaluate("localStorage.getItem('docentes-aragon:v1')")
    ok(ls and "0597" in ls and "NIF" not in ls, "se guarda en localStorage")
    pg.goto(url + "/index.html#/semana"); pg.wait_for_selector(".fila-esp.mia")
    ok(pg.locator(".fila-esp.mia").count() == 1, "la especialidad seguida se resalta en Semana")
    pg.screenshot(path=f"{out}/semana-con-yo.png")
    pg.goto(url + "/index.html#/historico"); pg.wait_for_selector(".grafico svg")
    ok(pg.locator("text=Tu posición").count() >= 1, "el histórico dibuja la línea 'Tu posición'")
    pg.screenshot(path=f"{out}/historico-con-yo.png")
    # recarga: persiste
    pg.reload(); pg.wait_for_selector(".grafico svg")
    ok(pg.locator("text=Tu posición").count() >= 1, "tras recargar siguen mis datos")
    pg.goto(url + "/index.html#/yo"); pg.wait_for_selector("#borrar"); pg.click("#borrar"); pg.click("#borrar-si")
    ok(pg.locator("[data-lista]").count() == 0, "borrar mis datos funciona")

    # --- cambio de curso
    pg.select_option("#curso", "2025-26"); pg.goto(url + "/index.html#/semana"); pg.wait_for_timeout(800)
    ok(pg.locator(".fila-esp, .vacio").count() > 0, "cambiar de curso no rompe la vista")
    print("errores consola:", errores[:6])
    ok(not errores, "sin errores de consola")
    b.close()
print("\nRESULTADO:", "TODO OK" if not fallos else f"{len(fallos)} fallos: {fallos}")
