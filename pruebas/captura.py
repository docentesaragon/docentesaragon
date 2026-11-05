"""Abre la web en Chromium (Playwright), recorre las secciones y guarda capturas. python3 captura.py URL CARPETA"""
import sys, json
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch()
    for nombre, ctx_args in (("pc", dict(viewport={"width": 1280, "height": 900})),
                             ("movil", dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        ctx = b.new_context(**ctx_args)
        pg = ctx.new_page()
        errores = []
        pg.on("console", lambda m: errores.append(m.text) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errores.append("PAGEERROR " + str(e)))
        pg.goto(url + "/index.html")
        pg.wait_for_selector(".fila-esp, .error", timeout=15000)
        for vista in ("semana", "historico", "vacantes", "mapa", "yo"):
            pg.goto(f"{url}/index.html#/{vista}")
            pg.wait_for_timeout(1200)
            pg.screenshot(path=f"{out}/{nombre}-{vista}.png", full_page=(vista != "mapa"))
        print(nombre, "errores de consola:", errores[:8])
        ctx.close()
    b.close()
