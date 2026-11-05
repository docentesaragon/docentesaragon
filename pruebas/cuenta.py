"""Prueba de la zona de pago con el Supabase de mentira: cuentas con correo y contrasena (crear, confirmar por correo, entrar,
recuperar contrasena), pase, compra con Play (simulada), sincronizacion de "Mi seguimiento", cierre de sesion y borrado de datos.
Google queda apagado por defecto; se prueba aparte con el interruptor encendido.   python3 cuenta.py
Arranca solo el servidor de mentira y la web; no toca ningun servicio real."""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

AQUI = os.path.dirname(os.path.abspath(__file__)); RAIZ = os.path.dirname(AQUI)
SB, WEB = "http://127.0.0.1:54399", "http://127.0.0.1:8766"
fallos = []
def ok(c, msg):
    print(("OK   " if c else "FALLO ") + msg)
    if not c: fallos.append(msg)

def post(ruta, cuerpo):
    req = urllib.request.Request(SB + ruta, data=json.dumps(cuerpo).encode(), headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req).read()
def estado(): return json.load(urllib.request.urlopen(SB + "/__test/estado"))

procs = [subprocess.Popen([sys.executable, "-I", os.path.join(AQUI, "mock_supabase.py"), "54399"]),
         subprocess.Popen([sys.executable, "-m", "http.server", "8766", "--bind", "127.0.0.1"], cwd=os.path.join(RAIZ, "web"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
time.sleep(1.2)
try:
    env = {**os.environ, "SUPABASE_URL": SB, "SUPABASE_SERVICE_KEY": "service-test-key"}
    r = subprocess.run([sys.executable, "-I", os.path.join(RAIZ, "pipeline", "cargar_supabase.py"), os.path.join(RAIZ, "web", "data"), "--cursos", "2026-27"], env=env, capture_output=True, text=True)
    ok(r.returncode == 0 and "Listo." in r.stdout, "carga de datos al Supabase de mentira con cabeceras de esquema")

    CONFIG = "window.CONFIG={supabaseUrl:'%s',supabaseAnonKey:'anon-test-key',supabaseSchema:'aragon',precio:'7,49 €',loginGoogle:false,cuentaCompartidaCon:'DocentsCV'};" % SB
    CONFIG_GOOGLE = CONFIG.replace("loginGoogle:false", "loginGoogle:true")
    PLAY = """
      window.__compras = [];
      window.getDigitalGoodsService = async () => ({
        getDetails: async (ids) => ids.map(id => ({ itemId: id, price: { currency: 'EUR', value: '6.99' } })),
        listPurchases: async () => window.__compras });
      window.PaymentRequest = class { constructor(m) { this.m = m; }
        async show() { window.__sku = this.m[0].data.sku; return { details: { purchaseToken: window.__token }, complete: async (x) => { window.__completo = x; } }; } };
    """
    def nuevo(b, play=False, config=None):
        ctx = b.new_context(viewport={"width": 1100, "height": 900})
        ctx.route("**/js/config.js", lambda rt: rt.fulfill(body=config or CONFIG, content_type="application/javascript"))
        if play: ctx.add_init_script(PLAY)
        pg = ctx.new_page(); errores = []
        pg.on("pageerror", lambda e: errores.append("PAGEERROR " + str(e)))
        pg.on("console", lambda m: errores.append(m.text) if m.type == "error" and not any(c in m.text for c in ("400", "401", "402", "403", "404", "409", "422", "429")) else None)
        return ctx, pg, errores
    def entrar_como(pg, email, clave="clave-segura-1"):
        post("/__test/usuario", {"email": email})          # ya existe y esta confirmado (no hace nada si ya estaba)
        pg.fill("#au-mail", email); pg.fill("#au-pass", clave); pg.click("#au-go"); pg.wait_for_selector("#cuenta-email")
    def texto(pg, sel): return pg.inner_text(sel) if pg.query_selector(sel) else ""
    def cap(pg, nombre):
        if len(sys.argv) > 1: pg.screenshot(path=os.path.join(sys.argv[1], nombre + ".png"), full_page=True)

    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---------- A. web de escritorio, sin Google Play ----------
        ctx, pg, errores = nuevo(b)
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go")
        ok("7,49 €" in texto(pg, "#precio") and "30/06/2027" in texto(pg, "#vista"), "sin sesión: pantalla de entrada con precio y fecha 30/06/2027")
        cap(pg, "yo_entrada")
        ok(pg.query_selector("#form-lista") is None, "sin sesión: no se ve el formulario de seguimiento")
        ok(pg.query_selector("#au-mail") is not None and pg.query_selector("#au-pass") is not None, "sin sesión: formulario de correo y contraseña")
        pg.goto(WEB + "/index.html#/semana"); pg.wait_for_selector(".fila-esp")
        ok(pg.locator(".fila-esp").count() > 3, "las consultas son gratis: Semana carga datos sin cuenta")
        pg.goto(WEB + "/index.html#/mapa"); pg.wait_for_selector("#mapa-svg .nube circle")
        pg.locator("#mapa-svg .nube circle").first.click(); pg.wait_for_selector("#destino")
        pg.click("#destino"); pg.wait_for_selector("#au-go")
        ok(pg.evaluate("location.hash").startswith("#/yo"), "añadir destino desde el mapa sin cuenta lleva a Mi seguimiento")

        entrar_como(pg, "ana@test.es")
        ok(texto(pg, "#cuenta-email") == "ana@test.es", "tras entrar con correo y contraseña: sesión de ana@test.es")
        ok("access_token" not in pg.evaluate("location.href"), "la dirección queda limpia (sin tokens)")
        ok(pg.query_selector("#comprar") is None and pg.query_selector("#comprobar") is not None, "sin Play: se explica que se compra desde la app de Android")
        ok(pg.query_selector("#form-lista") is None, "sin pase: sigue sin verse el seguimiento")
        cap(pg, "yo_sin_pase")

        post("/__test/pase", {"email": "ana@test.es", "expira": "2027-06-30", "producto": "pase_2026_27"})
        pg.click("#comprobar"); pg.wait_for_selector("#form-lista")
        ok("30/06/2027" in texto(pg, "#pase-activo"), "con pase: «Pase activo hasta el 30/06/2027»")

        pg.select_option("#y-esp", index=0)
        pg.fill("#y-fecha", "2026-07-22"); pg.fill("#y-bloque", "30"); pg.fill("#y-orden", "100")
        pg.click("#y-anadir"); pg.wait_for_selector("[data-lista]")
        pg.wait_for_function("document.getElementById('sync-estado') && document.getElementById('sync-estado').textContent.includes('Guardado')")
        ok(True, "estado «Guardado en tu cuenta.»")
        seg = estado()["seguimiento"]; datos = list(seg.values())[0]["datos"] if seg else {}
        ok(len(datos.get("listas", [])) == 1 and datos["listas"][0]["clave"] == "1-20260722-030-00100", "la lista se guardó en el servidor, con la clave correcta")
        pg.fill("#d-loc", "Zaragoza"); pg.click("#d-anadir"); pg.wait_for_selector("#destinos .chip")
        pg.wait_for_function("document.getElementById('sync-estado').textContent.includes('Guardado')")
        time.sleep(0.2)
        datos = list(estado()["seguimiento"].values())[0]["datos"]
        ok(len(datos["destinos"]) == 1, "el destino también se sincroniza")
        locales = pg.evaluate("JSON.stringify(Object.entries(localStorage))")
        ok("docentes-aragon:v1" not in locales and "destinos" not in locales, "localStorage sin datos personales (solo sesión y preferencia)")

        pg.reload(); pg.wait_for_selector("[data-lista]")
        ok(pg.locator("#destinos .chip").count() == 1, "al recargar, listas y destinos vuelven del servidor")
        cap(pg, "yo_con_pase")
        pg.goto(WEB + "/index.html#/semana"); pg.wait_for_selector(".fila-esp")
        ok(pg.locator(".fila-esp.mia").count() >= 1, "Semana resalta la especialidad que sigo")

        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#salir"); pg.click("#salir"); pg.wait_for_selector("#au-go")
        pg.goto(WEB + "/index.html#/semana"); pg.wait_for_selector(".fila-esp")
        ok(pg.locator(".fila-esp.mia").count() == 0, "al cerrar sesión desaparece lo personal")
        ok("sesion" not in pg.evaluate("JSON.stringify(Object.keys(localStorage))"), "al cerrar sesión se borra la sesión guardada")

        # beto: sin pase.  carla: pase caducado
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go"); entrar_como(pg, "beto@test.es")
        ok(pg.query_selector("#form-lista") is None and pg.query_selector("#comprobar") is not None, "usuario sin pase no ve el seguimiento")
        pg.click("#salir"); pg.wait_for_selector("#au-go")
        post("/__test/pase", {"email": "carla@test.es", "expira": "2026-06-30"})
        entrar_como(pg, "carla@test.es")
        ok("caducó el 30/06/2026" in texto(pg, "#vista"), "pase caducado: se avisa de que caducó el 30/06/2026")
        pg.click("#salir"); pg.wait_for_selector("#au-go")

        # ana vuelve: sus datos siguen ahí; borra su cuenta
        entrar_como(pg, "ana@test.es"); pg.wait_for_selector("[data-lista]")
        ok(pg.locator("[data-lista]").count() == 1, "ana vuelve a entrar y recupera su seguimiento")
        pg.click("#cuenta-borrar"); pg.click("#cuenta-borrar-si"); pg.wait_for_selector("#au-go")
        e = estado()
        ok("ana@test.es" in [u["email"] for u in e["usuarios"].values()] and not e["seguimiento"] and not [x for x in e["pases"] if x["user_id"] in [k for k, u in e["usuarios"].items() if u["email"] == "ana@test.es"]], "borrar mis datos: desaparecen pase y seguimiento, pero el usuario compartido se queda")
        # peticiones: todas las de la API llevaron el esquema aragon (si no, el mock responde 404 y la web habría fallado)
        ok(not errores, "sin errores de consola en la web" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # ---------- B. app Android (Digital Goods API simulada) ----------
        ctx, pg, errores = nuevo(b, play=True)
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go")
        pg.wait_for_function("document.getElementById('precio').textContent.includes('6,99')")
        ok(True, "dentro de la app se enseña el precio de Google Play (6,99 € en la simulación)")
        entrar_como(pg, "dora@test.es")
        ok(pg.query_selector("#comprar") is not None and pg.query_selector("#restaurar") is not None, "en la app: botones Comprar y Restaurar compra")
        cap(pg, "yo_app_play")
        pg.evaluate("window.__token = 'tok-pend-0000000001'"); pg.click("#comprar")
        pg.wait_for_function("document.getElementById('compra-msg').textContent.length > 0")
        ok("pendiente" in texto(pg, "#compra-msg") and pg.evaluate("window.__completo") == "fail", "pago pendiente: no se activa y se avisa")
        pg.evaluate("window.__token = 'tok-test-0000000001'"); pg.click("#comprar"); pg.wait_for_selector("#pase-activo")
        ok(pg.evaluate("window.__sku") == "pase_2026_27" and pg.evaluate("window.__completo") == "success", "compra: producto pase_2026_27 y compra confirmada")
        ok("30/06/2027" in texto(pg, "#pase-activo"), "compra: pase activo hasta el 30/06/2027")
        pg.click("#salir"); pg.wait_for_selector("#au-go")
        entrar_como(pg, "eli@test.es")
        pg.evaluate("window.__token = 'tok-test-0000000001'"); pg.click("#comprar")
        pg.wait_for_function("document.getElementById('compra-msg').textContent.length > 0")
        ok("otra cuenta" in texto(pg, "#compra-msg") and pg.query_selector("#form-lista") is None, "la misma compra no sirve en otra cuenta")
        pg.click("#salir"); pg.wait_for_selector("#au-go")
        entrar_como(pg, "fabi@test.es")
        pg.evaluate("window.__compras = [{itemId: 'pase_2026_27', purchaseToken: 'tok-test-restaurar-01'}]"); pg.click("#restaurar"); pg.wait_for_selector("#pase-activo")
        ok(True, "«Restaurar compra» activa el pase a partir de las compras de Google Play")
        pg.click("#salir"); pg.wait_for_selector("#au-go")
        entrar_como(pg, "gus@test.es")
        pg.evaluate("window.__compras = []")      # ahora no se recarga la página al entrar, así que se vacía a mano
        pg.click("#restaurar"); pg.wait_for_function("document.getElementById('compra-msg').textContent.length > 0")
        ok("ninguna compra" in texto(pg, "#compra-msg"), "restaurar sin compras: mensaje claro")
        ok(not errores, "sin errores de consola en la app" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # ---------- C. móvil: se ve bien ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.route("**/js/config.js", lambda rt: rt.fulfill(body=CONFIG, content_type="application/javascript"))
        pg = ctx.new_page(); pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go")
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "móvil: sin scroll horizontal en la pantalla de entrada")
        pg.click("#au-alt"); pg.wait_for_selector("#au-ok")
        ok(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "móvil: sin scroll horizontal al crear cuenta")
        if len(sys.argv) > 1: pg.screenshot(path=os.path.join(sys.argv[1], "yo_entrada_movil.png"), full_page=True)
        ctx.close()

        # ---------- D. correo y contraseña: validaciones, alta con confirmación, recuperar contraseña ----------
        ctx, pg, errores = nuevo(b)
        def msg(pg): return texto(pg, "#au-msg")
        def espera_msg(pg, trozo): pg.wait_for_function("t => document.getElementById('au-msg') && document.getElementById('au-msg').textContent.includes(t)", arg=trozo)
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go")
        ok(pg.query_selector("#entrar-google") is None, "por defecto no hay botón de Google (queda para más adelante)")
        ok("DocentsCV" in texto(pg, "#au-compartida"), "se avisa de que la cuenta de DocentsCV sirve también aquí")
        cap(pg, "yo_entrada")
        pg.fill("#au-mail", "esto no es un correo"); pg.fill("#au-pass", "clave-segura-1"); pg.click("#au-go")
        ok("correo válido" in msg(pg), "correo mal escrito: «Escribe un correo válido.»")
        pg.fill("#au-mail", "nuevo@test.es"); pg.fill("#au-pass", "corta"); pg.click("#au-go")
        ok("al menos 8 caracteres" in msg(pg), "contraseña corta: «al menos 8 caracteres»")
        pg.fill("#au-pass", "clave-segura-1"); pg.click("#au-go"); espera_msg(pg, "incorrectos")
        ok("Correo o contraseña incorrectos." in msg(pg), "correo que no existe: «Correo o contraseña incorrectos.»")
        pg.fill("#au-mail", "limite@test.es"); pg.click("#au-go"); espera_msg(pg, "Demasiados")
        ok("Demasiados intentos" in msg(pg), "límite de intentos: mensaje claro")
        ana_mal = "ana@test.es"
        pg.fill("#au-mail", ana_mal); pg.fill("#au-pass", "otra-clave-mal"); pg.click("#au-go"); espera_msg(pg, "incorrectos")
        ok(pg.query_selector("#cuenta-email") is None, "contraseña equivocada: no entra")

        # alta
        pg.fill("#au-mail", "nuevo@test.es"); pg.click("#au-alt"); pg.wait_for_selector("#au-ok")
        ok(texto(pg, "#au-title") == "Crear cuenta" and "nuevo@test.es" == pg.input_value("#au-mail"), "«Crear cuenta»: cambia el formulario y conserva el correo escrito")
        pg.fill("#au-pass", "clave-segura-1"); pg.click("#au-go")
        ok("política de privacidad" in msg(pg), "crear cuenta sin aceptar la privacidad: se pide")
        pg.check("#au-ok"); pg.click("#au-go"); espera_msg(pg, "Te hemos enviado un correo")
        ok("DocentsCV" in msg(pg), "el aviso de alta recuerda que con cuenta de DocentsCV no llega correo")
        cap(pg, "yo_alta")
        e = estado(); u = next((x for x in e["usuarios"].values() if x["email"] == "nuevo@test.es"), None)
        ok(len(e["correos"]) == 1 and e["correos"][0]["tipo"] == "confirmar" and u and not u["confirmado"], "alta: un correo de confirmación y cuenta sin confirmar")
        ok(u and u["meta"].get("version_privacidad_aragon") == "2026-11" and u["meta"].get("acepta_privacidad_aragon"), "se guarda la aceptación de la privacidad (claves propias de Aragón)")
        pg.click("#au-alt"); pg.fill("#au-mail", "nuevo@test.es"); pg.fill("#au-pass", "clave-segura-1"); pg.click("#au-go"); espera_msg(pg, "confirmado")
        ok("Aún no has confirmado tu correo" in msg(pg), "entrar sin confirmar el correo: se explica")
        enlace = e["correos"][0]["enlace"]
        pg.goto(enlace); pg.wait_for_selector("#cuenta-email")
        ok(texto(pg, "#cuenta-email") == "nuevo@test.es" and "access_token" not in pg.evaluate("location.href"), "enlace de confirmación: entra con la sesión y la dirección queda limpia")
        ok("quedan 15 días" in texto(pg, "#aviso-prueba") and pg.query_selector("#form-lista") is not None and pg.query_selector("#au-mail") is None, "recién confirmada: entra con 15 días de prueba y ya puede apuntar sus listas")
        pg.goto(enlace); pg.wait_for_selector("#cuenta-mensaje")
        ok("caducado" in texto(pg, "#cuenta-mensaje"), "enlace ya usado: «ha caducado o ya se ha usado»")
        pg.evaluate("localStorage.clear()"); pg.goto(WEB + "/index.html#/yo"); pg.reload(); pg.wait_for_selector("#au-go")

        # alta con un correo que ya existe (p. ej. de DocentsCV): sin correo y sin pistas
        pg.click("#au-alt"); pg.fill("#au-mail", "ana@test.es"); pg.fill("#au-pass", "clave-segura-1"); pg.check("#au-ok"); pg.click("#au-go"); espera_msg(pg, "Te hemos enviado")
        ok(len(estado()["correos"]) == 1, "alta con un correo que ya existe: no se envía otro correo y no se revela que existe")

        # recuperar contraseña
        pg.click("#au-alt"); pg.click("#au-forgot")
        ok(texto(pg, "#au-title") == "Recuperar contraseña" and pg.query_selector("#au-pass") is None, "«He olvidado mi contraseña»: solo pide el correo")
        pg.fill("#au-mail", "nadie@test.es"); pg.click("#au-go"); espera_msg(pg, "Si el correo existe")
        ok(len(estado()["correos"]) == 1, "recuperar con un correo desconocido: mismo mensaje y ningún correo")
        pg.fill("#au-mail", "nuevo@test.es"); pg.click("#au-go"); espera_msg(pg, "Si el correo existe")
        e = estado(); ok(len(e["correos"]) == 2 and e["correos"][1]["tipo"] == "recuperar", "recuperar: llega el correo con el enlace")
        pg.goto(e["correos"][1]["enlace"]); pg.wait_for_selector("#au-pass")
        ok(texto(pg, "#au-title") == "Nueva contraseña" and pg.query_selector("#au-mail") is None, "enlace de recuperación: pantalla de nueva contraseña")
        cap(pg, "yo_nueva_clave")
        pg.fill("#au-pass", "corta"); pg.click("#au-go"); ok("al menos 8" in msg(pg), "nueva contraseña corta: se pide más larga")
        pg.fill("#au-pass", "clave-segura-1"); pg.click("#au-go"); espera_msg(pg, "distinta")
        ok("distinta" in msg(pg), "misma contraseña de antes: se pide una distinta")
        pg.fill("#au-pass", "clave-nueva-2"); pg.click("#au-go"); pg.wait_for_selector("#cuenta-email")
        ok(texto(pg, "#cuenta-email") == "nuevo@test.es" and pg.query_selector("#au-pass") is None, "contraseña guardada: queda dentro de su cuenta")
        pg.click("#salir"); pg.wait_for_selector("#au-go")
        pg.fill("#au-mail", "nuevo@test.es"); pg.fill("#au-pass", "clave-segura-1"); pg.click("#au-go"); espera_msg(pg, "incorrectos")
        ok(pg.query_selector("#cuenta-email") is None, "la contraseña antigua ya no vale")
        pg.fill("#au-pass", "clave-nueva-2"); pg.click("#au-go"); pg.wait_for_selector("#cuenta-email")
        ok(True, "la nueva contraseña sí entra")
        ok(not errores, "sin errores de consola (correo y contraseña)" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # ---------- E. Google, apagado por defecto: con el interruptor encendido sigue funcionando ----------
        ctx, pg, errores = nuevo(b, config=CONFIG_GOOGLE)
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#entrar-google")
        post("/__test/siguiente", {"email": "hugo@test.es"})
        pg.click("#entrar-google"); pg.wait_for_selector("#cuenta-email")
        ok(texto(pg, "#cuenta-email") == "hugo@test.es", "con loginGoogle encendido: «Entrar con Google» funciona")
        ok(not errores, "sin errores de consola (Google)" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # ---------- F. prueba gratuita de 15 días ----------
        ctx, pg, errores = nuevo(b)
        post("/__test/usuario", {"email": "lola@test.es", "cuenta": "nueva"})
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go")
        ok("Prueba gratis 15 días" in texto(pg, "#prueba-gratis"), "entrada: se anuncia la prueba gratis de 15 días")
        entrar_como(pg, "lola@test.es"); pg.wait_for_selector("#aviso-prueba")
        ok("te quedan 15 días" in texto(pg, "#aviso-prueba") and "7,49 €" in texto(pg, "#aviso-prueba") and "30/06/2027" in texto(pg, "#aviso-prueba") and "sin renovación" in texto(pg, "#aviso-prueba"), "la primera vez: «te quedan 15 días» y, después, 7,49 € hasta el 30/06/2027 en pago único")
        ok("Prueba gratuita: 15 días" in texto(pg, "#pase-activo"), "la barra de cuenta dice «Prueba gratuita: 15 días»")
        ok(pg.query_selector("#form-lista") is not None, "en prueba ya se puede apuntar la posición en las listas")
        cap(pg, "yo_prueba")
        pg.select_option("#y-esp", index=0); pg.fill("#y-fecha", "2026-07-22"); pg.fill("#y-bloque", "30"); pg.fill("#y-orden", "100")
        pg.click("#y-anadir"); pg.wait_for_selector("[data-lista]")
        pg.wait_for_function("document.getElementById('sync-estado').textContent.includes('Guardado')")
        ok(len(list(estado()["seguimiento"].values())[0]["datos"]["listas"]) == 1, "durante la prueba lo apuntado se guarda en el servidor")
        e = estado(); uid_lola = next(k for k, u in e["usuarios"].items() if u["email"] == "lola@test.es")
        ok(len([x for x in e["pases"] if x["user_id"] == uid_lola and x["tipo"] == "prueba"]) == 1, "se creó una sola prueba para lola")
        pg.reload(); pg.wait_for_selector("#aviso-prueba")
        ok(len([x for x in estado()["pases"] if x["user_id"] == uid_lola and x["tipo"] == "prueba"]) == 1 and "te quedan 15 días" in texto(pg, "#aviso-prueba"), "volver a entrar no da otra prueba ni la alarga")
        # tarjeta de invitar
        pg.wait_for_selector("#ref-codigo")
        codigo_lola = texto(pg, "#ref-codigo")
        import re as _re
        ok(_re.fullmatch(r"ARA-[A-HJ-NP-Z2-9]{5}", codigo_lola) is not None, "tarjeta «Invita y consigue la app gratis» con un código ARA-XXXXX: " + codigo_lola)
        ok("Invitados: 0" in texto(pg, "#ref-cuenta") and "0 de 3" in texto(pg, "#ref-cuenta"), "contador: invitados 0, han pagado 0 de 3")
        ok(pg.get_attribute("#ref-wa", "href").startswith("https://wa.me/?text=") and codigo_lola in pg.get_attribute("#ref-wa", "href") and "ref%3D" in pg.get_attribute("#ref-wa", "href"), "WhatsApp: mensaje con el código y el enlace de invitación")
        ok(pg.get_attribute("#ref-tg", "href").startswith("https://t.me/share/url?url="), "Telegram: enlace para compartir")
        pg.click("#ref-copiar"); pg.wait_for_function("document.getElementById('ref-msg').textContent.length > 0")
        ok(True, "«Copiar mensaje» responde (copia, o enseña el texto si el navegador no deja)")
        cap(pg, "yo_invitar")
        # activar el pase durante la prueba
        pg.click("#activar-pase"); pg.wait_for_selector("#volver")
        ok("Activa tu pase" in texto(pg, "#pase-titulo") and pg.query_selector("#comprobar") is not None, "«Activar mi pase» durante la prueba: pantalla de compra")
        pg.click("#volver"); pg.wait_for_selector("#aviso-prueba")
        ok(pg.query_selector("#form-lista") is not None, "«Volver a Mi seguimiento» devuelve a la prueba")
        ok(not errores, "sin errores de consola (prueba gratuita)" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # comprar con la app durante la prueba (quedan 12 días)
        ctx, pg, errores = nuevo(b, play=True)
        post("/__test/usuario", {"email": "marta@test.es", "cuenta": "con_prueba"})
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go"); entrar_como(pg, "marta@test.es"); pg.wait_for_selector("#aviso-prueba")
        ok("te quedan 12 días" in texto(pg, "#aviso-prueba"), "con la prueba empezada hace 3 días: «te quedan 12 días»")
        pg.click("#activar-pase"); pg.wait_for_selector("#comprar")
        pg.evaluate("window.__token = 'tok-test-prueba-marta'"); pg.click("#comprar"); pg.wait_for_selector("#form-lista")
        ok("Pase activo hasta el 30/06/2027" in texto(pg, "#pase-activo") and pg.query_selector("#aviso-prueba") is None, "compra durante la prueba: pasa a «Pase activo hasta el 30/06/2027» y desaparece el aviso de prueba")
        ok(not errores, "sin errores de consola (comprar en la prueba)" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # ---------- G. prueba terminada ----------
        ctx, pg, errores = nuevo(b)
        post("/__test/usuario", {"email": "nora@test.es", "cuenta": "prueba_caducada"})
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go"); entrar_como(pg, "nora@test.es"); pg.wait_for_selector("#pase-titulo")
        ok("prueba gratuita ha terminado" in texto(pg, "#pase-titulo") and pg.query_selector("#form-lista") is None, "prueba acabada: «Tu prueba gratuita ha terminado» y sin seguimiento")
        pg.wait_for_selector("#ref-codigo")
        ok(pg.query_selector("#ref-codigo") is not None, "con la prueba acabada aún puede invitar para conseguir la app gratis")
        ok(pg.query_selector("#ref-in") is not None, "dentro de los 30 días de su cuenta puede poner el código de quien la invitó")
        cap(pg, "yo_prueba_terminada")
        ok(not errores, "sin errores de consola (prueba terminada)" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # ---------- H. invitaciones: enlace, código al crear la cuenta, 3 pagos = app gratis, usar código ----------
        ctx, pg, errores = nuevo(b)
        pg.goto(WEB + "/index.html?ref=" + codigo_lola.lower()); pg.wait_for_selector("#au-ref")
        ok(pg.evaluate("location.hash") == "#/yo" and "ref=" not in pg.evaluate("location.search"), "enlace de invitación: lleva a Mi seguimiento y limpia la dirección")
        ok(texto(pg, "#au-title") == "Crear cuenta" and pg.input_value("#au-ref") == codigo_lola, "el enlace abre «Crear cuenta» con el código ya puesto")
        ok("Te ha invitado" in texto(pg, "#prueba-gratis"), "se avisa de que viene invitada")
        pg.fill("#au-mail", "inv1@test.es"); pg.fill("#au-pass", "clave-segura-1"); pg.check("#au-ok"); pg.click("#au-go"); espera_msg(pg, "Te hemos enviado un correo")
        e = estado(); u1 = next(x for x in e["usuarios"].values() if x["email"] == "inv1@test.es")
        ok(u1["meta"].get("codigo_invitacion_aragon") == codigo_lola, "el código viaja con los datos de la cuenta nueva")
        ok(pg.evaluate("localStorage.getItem('docentes-aragon:ref')") is None, "el código guardado se borra al crear la cuenta")
        pg.goto(e["correos"][-1]["enlace"]); pg.wait_for_selector("#aviso-prueba")
        e = estado(); uid1 = next(k for k, x in e["usuarios"].items() if x["email"] == "inv1@test.es")
        ok(e["cuentas"][uid1]["referido_por"] == uid_lola, "al entrar por primera vez se aplica el código: la invitó lola")
        pg.wait_for_selector("#ref-codigo"); ok(pg.query_selector("#ref-in") is None, "quien ya usó un código no ve el campo para otro")
        ctx.close()

        # lola ve el contador; otros dos invitados; tres pagos -> app gratis
        post("/__test/usuario", {"email": "inv2@test.es"}); post("/__test/usuario", {"email": "inv3@test.es"})
        post("/__test/invitado", {"email": "inv2@test.es", "de": "lola@test.es"}); post("/__test/invitado", {"email": "inv3@test.es", "de": "lola@test.es"})
        ctx, pg, errores = nuevo(b)
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go"); entrar_como(pg, "lola@test.es"); pg.wait_for_selector("#ref-codigo")
        ok("Invitados: 3" in texto(pg, "#ref-cuenta") and "0 de 3" in texto(pg, "#ref-cuenta"), "lola ve 3 invitados y 0 pagados")
        for i, mail in enumerate(["inv1@test.es", "inv2@test.es"], 1):
            post("/__test/pase", {"email": mail, "expira": "2027-06-30", "tipo": "pago_unico", "producto": "pase_2026_27"})
        pg.reload(); pg.wait_for_selector("#ref-codigo")
        ok("2 de 3" in texto(pg, "#ref-cuenta") and pg.query_selector("#aviso-gratis") is None, "con 2 pagos: «2 de 3» y todavía no es gratis")
        post("/__test/pase", {"email": "inv3@test.es", "expira": "2027-06-30", "tipo": "pago_unico", "producto": "pase_2026_27"})
        pg.reload(); pg.wait_for_selector("#aviso-gratis")
        ok("Tienes la app gratis este curso" in texto(pg, "#aviso-gratis") and "30/06/2027" in texto(pg, "#aviso-gratis"), "con el tercer pago: «Tienes la app gratis este curso» hasta el 30/06/2027")
        ok("App gratis hasta el 30/06/2027" in texto(pg, "#pase-activo") and "3 de 3" in texto(pg, "#ref-cuenta") and "Conseguido" in texto(pg, "#ref-cuenta"), "la barra y la tarjeta lo reflejan")
        cap(pg, "yo_app_gratis")
        ok(not errores, "sin errores de consola (invitaciones)" + (": " + "; ".join(errores) if errores else ""))
        ctx.close()

        # usar el código de otra persona desde la tarjeta
        ctx, pg, errores = nuevo(b)
        post("/__test/usuario", {"email": "juan@test.es", "cuenta": "con_prueba"})
        pg.goto(WEB + "/index.html#/yo"); pg.wait_for_selector("#au-go"); entrar_como(pg, "juan@test.es"); pg.wait_for_selector("#ref-in")
        def probar(codigo):
            pg.fill("#ref-in", codigo); pg.click("#ref-usar"); pg.wait_for_function("document.getElementById('ref-msg').textContent.length > 0")
            return texto(pg, "#ref-msg")
        ok("propio código" in probar(texto(pg, "#ref-codigo")), "usar el propio código: no se puede")
        pg.evaluate("document.getElementById('ref-msg').textContent = ''")
        ok("no existe" in probar("ARA-NOEXI"), "usar un código inventado: «Ese código no existe»")
        pg.evaluate("document.getElementById('ref-msg').textContent = ''")
        ok("Código aplicado" in probar(codigo_lola.lower()), "usar el código de lola (en minúsculas): «¡Código aplicado!»")
        pg.wait_for_function("!document.getElementById('ref-in')")
        ok(pg.query_selector("#ref-in") is None, "después desaparece el campo (solo se usa una vez)")
        post("/__test/usuario", {"email": "tarde@test.es", "cuenta": "con_prueba"}); post("/__test/mover_alta", {"email": "tarde@test.es", "dias": 31})
        pg.click("#salir"); pg.wait_for_selector("#au-go"); entrar_como(pg, "tarde@test.es"); pg.wait_for_selector("#ref-codigo")
        ok(pg.query_selector("#ref-in") is None, "pasados 30 días de la cuenta ya no se puede poner un código")
        ok(not errores, "sin errores de consola (usar código)" + (": " + "; ".join(errores) if errores else ""))
        ctx.close(); b.close()
finally:
    for pr in procs: pr.terminate()
print("\nRESULTADO:", "TODO OK" if not fallos else f"{len(fallos)} FALLOS")
sys.exit(1 if fallos else 0)
