#!/usr/bin/env python3
"""Envía los avisos de la app: (1) «favoritos»: vacantes nuevas y adjudicaciones en los centros que cada persona ha marcado como
favoritos; (2) «listas»: cómo ha ido la adjudicación de la semana para cada lista que la persona sigue en Mi seguimiento.

    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="eyJ..."          # clave SECRETA service_role
    python3 pipeline/avisos.py [--simular]        # --simular: enseña los avisos que enviaría, sin enviar ni anotar nada

Lo ejecuta semanal.py justo después de subir los datos nuevos. Qué avisar lo decide la base de datos (función avisos_pendientes);
aquí solo se redactan los mensajes y se envían a los dispositivos. Necesita:  pip install cryptography
Las claves VAPID (la identidad del servidor de avisos) se crean solas la primera vez y se guardan en la tabla privada aragon.servidor.
Si un aviso no se puede enviar por un fallo pasajero, no se anota como enviado y se reintenta en la siguiente ejecución.
En el registro solo salen cantidades, nunca correos ni nombres.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ESQUEMA = os.environ.get("SUPABASE_SCHEMA", "aragon")
URL_WEB = os.environ.get("URL_WEB", "https://docentesaragon.github.io").rstrip("/")
MAX_INDIVIDUALES = 3        # más novedades que estas a la vez en una misma persona: un solo aviso-resumen


# ---------- redacción (equivale a bonito / localidadBonita / centroBonito de web/js/util.js) ----------
MENORES = {"de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "al"}


def bonito(t):
    if not t:
        return ""
    partes = re.split(r"(\s+|-)", t.lower())
    return "".join(w if (i > 0 and w in MENORES) else re.sub(r"^\(?[^\W\d_]", lambda m: m.group(0).upper(), w) for i, w in enumerate(partes))


def localidad_bonita(t):
    m = re.match(r"^(.*)\s\((LA|EL|LAS|LOS)\)$", t or "")
    return bonito(f"{m.group(2)} {m.group(1)}" if m else t)


def centro_bonito(t):
    if not t:
        return ""
    p = t.split()
    i = 1 if len(p) > 1 and re.fullmatch(r"[A-ZÁÉÍÓÚÑ]{2,6}", p[0]) else 0
    return " ".join(p[:i] + [bonito(" ".join(p[i:]))]).strip()


def plural(n, uno, varios):
    return f"{n} {uno if n == 1 else varios}"


def lista_corta(nombres, maximo=3):
    nombres = sorted({n for n in nombres if n})
    if len(nombres) <= maximo:
        return ", ".join(nombres)
    return ", ".join(nombres[:maximo]) + f" y {len(nombres) - maximo} más"


MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def fecha_corta(iso):
    """'2026-11-04' -> '4 de noviembre' (si no es una fecha, cadena vacía)."""
    m = re.fullmatch(r"(\d{4})-(\d\d)-(\d\d)", str(iso or "")[:10])
    if not m or not 1 <= int(m.group(2)) <= 12:
        return ""
    return f"{int(m.group(3))} de {MESES[int(m.group(2)) - 1]}"


# lo que se dice de una lista según cómo fue la semana (equivale a situacion() de web/js/comun.js)
ESTADO_LISTA = {
    "alcanzada": ("esta semana la lista llegó a tu posición", "llegó a tu posición"),
    "convocado": ("estabas entre los convocados, pero la lista no llegó a ti", "estabas entre los convocados, pero no llegó a ti"),
    "no-llego": ("esta semana la lista no llegó a tu posición", "no llegó a tu posición"),
    "lejos": ("esta semana la lista no llegó a tu posición", "no llegó a tu posición"),
}


def redactar_lista(a):
    largo, _corto = ESTADO_LISTA.get(a.get("estado"), ESTADO_LISTA["lejos"])
    esp = bonito(a.get("esp_nombre") or a.get("esp_cod") or "tu lista")
    titulo = f"{esp}: {largo}"
    f = fecha_corta(a.get("fecha"))
    cuerpo = (f"Adjudicación del {f}. " if f else "") + ("Entra para ver tus opciones." if a.get("estado") == "alcanzada" else "Entra para ver cómo va tu lista.")
    return {"t": titulo[:90], "b": cuerpo[:180], "u": "#/yo", "g": a["clave"]}


def resumen_listas(avisos):
    """Varias listas de la misma persona en un solo aviso."""
    partes = []
    for a in sorted(avisos, key=lambda x: (x.get("estado") != "alcanzada", bonito(x.get("esp_nombre") or ""))):
        _largo, corto = ESTADO_LISTA.get(a.get("estado"), ESTADO_LISTA["lejos"])
        partes.append(f"{bonito(a.get('esp_nombre') or a.get('esp_cod') or 'Lista')}: {corto}")
    llegaron = sum(1 for a in avisos if a.get("estado") == "alcanzada")
    titulo = ("Esta semana la adjudicación llegó a tu posición en " + plural(llegaron, "lista", "listas")) if llegaron else f"Tus {len(avisos)} listas esta semana"
    cuerpo = " · ".join(partes[:3]) + (f" · y {len(partes) - 3} más" if len(partes) > 3 else "")
    return {"t": titulo[:90], "b": cuerpo[:180], "u": "#/yo", "g": "listas"}


def redactar(a):
    """Un aviso de la base de datos -> mensaje para el móvil: t = título, b = texto, u = adónde lleva, g = etiqueta (no se repite)."""
    if a.get("tipo") == "lista":
        return redactar_lista(a)
    centro, loc, n, esp = centro_bonito(a["centro"]), localidad_bonita(a["localidad"]), int(a["n"]), a.get("esp") or []
    if a["tipo"] == "adjudicada":
        titulo = f"Adjudicación en {centro}"
        cuerpo = f"{loc}: {plural(n, 'vacante adjudicada', 'vacantes adjudicadas')}"
        estado = "adjudicada"
    else:
        titulo = f"Vacante nueva en {centro}"
        cuerpo = f"{loc}: {plural(n, 'vacante', 'vacantes')}"
        estado = "sin"
    if esp:
        cuerpo += f" · {lista_corta(esp)}"
    url = "#/vacantes?" + urllib.parse.urlencode({"cuerpo": "todos", "semana": "ult4", "estado": estado, "centro": a["centro"]}, quote_via=urllib.parse.quote)
    return {"t": titulo[:90], "b": cuerpo[:180], "u": url, "g": a["clave"]}


def agrupar(avisos):
    """[(mensaje, [claves que cubre])]. Las listas de una persona van juntas (una sola notificación si son varias); de los centros
    favoritos, pocas novedades: una notificación por cada una; muchas: un resumen."""
    listas = [a for a in avisos if a.get("tipo") == "lista"]
    favoritos = [a for a in avisos if a.get("tipo") != "lista"]
    salida = []
    if len(listas) == 1:
        salida.append((redactar(listas[0]), [listas[0]["clave"]]))
    elif listas:
        salida.append((resumen_listas(listas), [a["clave"] for a in listas]))
    if len(favoritos) <= MAX_INDIVIDUALES:
        salida.extend((redactar(a), [a["clave"]]) for a in favoritos)
    elif favoritos:
        centros = lista_corta([centro_bonito(a["centro"]) for a in favoritos], 2)
        salida.append(({"t": f"{len(favoritos)} novedades en tus centros favoritos", "b": centros, "u": "#/yo", "g": "resumen"}, [a["clave"] for a in favoritos]))
    return salida


# ---------- base de datos ----------
def rpc(url, clave, nombre, datos=None):
    req = urllib.request.Request(f"{url}/rest/v1/rpc/{nombre}", data=json.dumps(datos or {}).encode("utf-8"), method="POST",
                                 headers={"apikey": clave, "Authorization": "Bearer " + clave, "Content-Type": "application/json",
                                          "Accept-Profile": ESQUEMA, "Content-Profile": ESQUEMA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read().decode("utf-8")
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{nombre}: error {e.code} {e.read().decode('utf-8', 'replace')[:300]}") from None


def claves_vapid(url, clave, webpush):
    k = rpc(url, clave, "vapid_claves")
    if not k:
        publica, privada = webpush.generar_vapid()
        rpc(url, clave, "vapid_guardar", {"p_publica": publica, "p_privada": privada})
        k = rpc(url, clave, "vapid_claves")          # por si otro robot se adelantó: vale la que quedó guardada
        print("Claves de los avisos creadas (primera vez).")
    return k["publica"], k["privada"]


def repartir(pendientes, publica, privada, contacto, enviar):
    """Envía y devuelve [(user_id, claves entregadas, endpoints muertos)]. `enviar(dispositivo, mensaje) -> ok|muerto|invalido|reintentar|error`."""
    resultado = []
    for p in pendientes:
        entregadas, muertos = set(), set()
        for msg, claves in agrupar(p["avisos"]):
            llego = False
            for d in p["dispositivos"]:
                if d["endpoint"] in muertos:
                    continue
                r = enviar(d, msg)
                if r == "ok":
                    llego = True
                elif r in ("muerto", "invalido"):
                    muertos.add(d["endpoint"])
            if llego:
                entregadas.update(claves)
        resultado.append((p["user_id"], sorted(entregadas), sorted(muertos), len(p["avisos"])))
    return resultado


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true", help="enseña los avisos sin enviarlos ni anotarlos")
    a = ap.parse_args()
    url, clave = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not clave:
        sys.exit("Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY.")
    try:
        import webpush
    except ImportError:
        sys.exit("Falta la librería «cryptography» (pip install cryptography): no se envían avisos.")
    pendientes = rpc(url, clave, "avisos_pendientes") or []
    print(f"Avisos pendientes: {sum(len(p['avisos']) for p in pendientes)} para {len(pendientes)} personas.")
    if not pendientes:
        return
    if a.simular:
        for p in pendientes:
            for msg, _ in agrupar(p["avisos"]):
                print(" -", msg["t"], "|", msg["b"], "|", msg["u"])
        return
    publica, privada = claves_vapid(url, clave, webpush)
    contacto = os.environ.get("VAPID_SUBJECT") or URL_WEB
    res = repartir(pendientes, publica, privada, contacto, lambda d, m: webpush.enviar(d, m, publica, privada, contacto))
    enviados = quitados = 0
    for user_id, entregadas, muertos, _n in res:
        if entregadas:
            rpc(url, clave, "avisos_marcar", {"p_user": user_id, "p_claves": entregadas}); enviados += len(entregadas)
        if muertos:
            rpc(url, clave, "avisos_quitar", {"p_endpoints": muertos}); quitados += len(muertos)
    print(f"Avisos enviados: {enviados}. Dispositivos dados de baja (ya no existen): {quitados}. Sin entregar (se reintenta): {sum(p_n for *_, p_n in res) - enviados}.")


if __name__ == "__main__":
    main()
