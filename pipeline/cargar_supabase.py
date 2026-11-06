#!/usr/bin/env python3
"""Sube a Supabase las tablas públicas que genera procesar.py (sin dependencias: solo Python 3).

    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="eyJ..."        # clave SECRETA service_role (nunca en la web)
    python3 cargar_supabase.py ../web/data [--cursos 2026-27] [--dry-run]
    # opcional: export SUPABASE_SCHEMA="aragon"   (es el valor por defecto)

    python3 cargar_supabase.py --keepalive      # solo "toca" la tabla keepalive
    python3 cargar_supabase.py --solo-personas FICHERO   # solo los candidatos privados (ver procesar.py --personas)

Es idempotente: se puede ejecutar mil veces; las filas existentes se actualizan (upsert).
"""
import argparse
import datetime as dt
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

COLUMNAS = {
    "actos": ["acto", "cuerpo", "fecha_oferta", "fecha_adjudicacion", "curso", "n_ofertadas", "n_adjudicadas",
              "n_singulares_adjudicadas", "n_no_adjudicadas", "n_convocados", "tiene_candidatos", "tiene_adjudicadas"],
    "cuerpos": ["cod", "nombre"],
    "especialidades": ["cuerpo_cod", "cod", "nombre"],
    "localidades": ["localidad", "provincia", "lat", "lon", "aprox"],
    "vacantes": ["id", "acto", "curso", "cuerpo_cod", "esp", "vacante", "singular", "estado", "centro_cod", "centro",
                 "localidad", "provincia", "jornada", "duracion", "obligacion", "causa", "perfilada", "perfil",
                 "fecha_fin_estimada"],
    "ultimo_llamado": ["acto", "cuerpo_cod", "esp", "convocados", "clave_max_convocado", "vacantes", "adjudicadas",
                       "llamados", "llamados_otra_esp", "sin_resolver", "clave_ultimo", "relacion_ultimo", "reconstruido"],
}
CONFLICTO = {
    "actos": "acto", "cuerpos": "cod", "especialidades": "cuerpo_cod,cod", "localidades": "localidad,provincia",
    "vacantes": "id", "ultimo_llamado": "acto,cuerpo_cod,esp", "keepalive": "id",
}
LOTE = 500
ESQUEMA = os.environ.get("SUPABASE_SCHEMA", "aragon")   # esquema de Postgres donde estan las tablas (ver supabase/schema.sql)


def peticion(url, clave, metodo, datos=None, extra=None, reintentos=4):
    cab = {"apikey": clave, "Authorization": "Bearer " + clave, "Content-Type": "application/json",
           "Accept-Profile": ESQUEMA, "Content-Profile": ESQUEMA}
    cab.update(extra or {})
    cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8") if datos is not None else None
    for i in range(reintentos):
        try:
            req = urllib.request.Request(url, data=cuerpo, headers=cab, method=metodo)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            detalle = e.read().decode("utf-8", "replace")[:500]
            if e.code in (429, 500, 502, 503, 504) and i < reintentos - 1:
                time.sleep(2 ** i)
                continue
            sys.exit(f"ERROR {e.code} en {metodo} {url}\n{detalle}")
        except urllib.error.URLError as e:
            if i < reintentos - 1:
                time.sleep(2 ** i)
                continue
            sys.exit(f"No se pudo conectar con {url}: {e.reason}")


def upsert(base, clave, tabla, filas, dry=False, solo_nuevas=False):
    """solo_nuevas=True: inserta las filas que no existan y NO toca las que ya estan (ignore-duplicates)."""
    if not filas:
        return
    cols = COLUMNAS.get(tabla)
    if cols:   # mismas claves en todas las filas (lo que falta = null)
        filas = [{c: f.get(c) for c in cols} for f in filas]
    if dry:
        print(f"  [simulacro] {tabla}: {len(filas)} filas")
        return
    url = f"{base}/rest/v1/{tabla}?on_conflict={CONFLICTO[tabla]}"
    extra = {"Prefer": ("resolution=ignore-duplicates" if solo_nuevas else "resolution=merge-duplicates") + ",return=minimal"}
    for i in range(0, len(filas), LOTE):
        peticion(url, clave, "POST", filas[i:i + LOTE], extra)
    print(f"  {tabla}: {len(filas)} filas {'nuevas (las existentes no se tocan)' if solo_nuevas else 'subidas'}")


def cargar_personas(base, clave, ruta, dry=False):
    """Sube los candidatos del curso a la tabla PRIVADA aragon.personas (por la funcion cargar_personas, que guarda el nombre
    ya normalizado y descarta el original). Es un upsert: se puede repetir."""
    filas = json.load(open(ruta, encoding="utf-8"))
    por_curso = {}
    for f in filas:
        por_curso.setdefault(f["curso"], []).append({k: f[k] for k in ("nombre", "nif", "cuerpo_cod", "esp", "clave")})
    for curso in sorted(por_curso):
        lista = por_curso[curso]
        if dry:
            print(f"  [simulacro] personas {curso}: {len(lista)} filas")
            continue
        total = 0
        for i in range(0, len(lista), 1000):
            _, cuerpo = peticion(f"{base}/rest/v1/rpc/cargar_personas", clave, "POST", {"p_curso": curso, "p_filas": lista[i:i + 1000]})
            total += int(json.loads(cuerpo or "0"))
        print(f"  personas {curso}: {len(lista)} filas enviadas, {total} guardadas")


def leer_existentes(base, clave, tabla, actos):
    """Filas que ya hay en Supabase para esos actos (para no pisarlas con datos peores)."""
    out = []
    actos = sorted(actos)
    for i in range(0, len(actos), 15):
        lista = ",".join(urllib.parse.quote(a) for a in actos[i:i + 15])
        for off in range(0, 100000, 1000):
            url = f"{base}/rest/v1/{tabla}?select=*&acto=in.({lista})&limit=1000&offset={off}"
            _, cuerpo = peticion(url, clave, "GET")
            lote = json.loads(cuerpo)
            out.extend(lote)
            if len(lote) < 1000:
                break
    return out


def puntuacion_acto(a):
    return (bool(a.get("tiene_adjudicadas")), bool(a.get("tiene_candidatos")), (a.get("n_ofertadas") or 0) + (a.get("n_adjudicadas") or 0))


def puntuacion_ultimo(u):
    return (u.get("convocados") is not None, u.get("clave_ultimo") is not None, u.get("adjudicadas") or 0)


def no_empeorar(nuevas, existentes, clave_fila, puntuacion):
    """Quita de `nuevas` las filas que serian PEORES que la que ya esta guardada (p. ej. una ejecucion
    que no pudo bajar la adjudicacion no debe borrar la que se subio antes)."""
    previas = {clave_fila(f): f for f in existentes}
    return [f for f in nuevas if clave_fila(f) not in previas or puntuacion(f) >= puntuacion(previas[clave_fila(f)])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("carpeta", nargs="?", help="carpeta con los JSON de procesar.py")
    ap.add_argument("--cursos", default="", help="solo estos cursos, separados por comas (p. ej. 2026-27). Por defecto todos")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keepalive", action="store_true")
    ap.add_argument("--forzar", action="store_true", help="sobrescribe siempre, aunque los datos nuevos sean peores que los guardados")
    ap.add_argument("--personas", help="ademas, sube los candidatos privados de este fichero (lo escribe procesar.py --personas)")
    ap.add_argument("--solo-personas", help="solo sube los candidatos privados de este fichero y termina")
    a = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").strip().strip("\"'").strip().rstrip("/")
    if base.endswith("/rest/v1"):
        base = base[: -len("/rest/v1")]
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    clave = os.environ.get("SUPABASE_SERVICE_KEY", "").strip().strip("\"'").strip()
    if not a.dry_run and (not base or not clave):
        sys.exit("Faltan las variables SUPABASE_URL y SUPABASE_SERVICE_KEY (ver README, paso 4).")

    if a.keepalive:
        ahora = dt.datetime.now(dt.timezone.utc).isoformat()
        upsert(base, clave, "keepalive", [{"id": 1, "ultimo_ping": ahora}], a.dry_run)
        print("keep-alive ok", ahora)
        return

    if a.solo_personas:
        cargar_personas(base, clave, a.solo_personas, a.dry_run)
        print("Listo.")
        return
    if not a.carpeta:
        sys.exit("Indica la carpeta con los JSON.")
    cursos = [c for c in a.cursos.split(",") if c]
    cargar = lambda n: json.load(open(os.path.join(a.carpeta, n + ".json"), encoding="utf-8"))
    actos = cargar("actos")
    if cursos:
        actos = [x for x in actos if x["curso"] in cursos]
    permitidos = {x["acto"] for x in actos}
    print("Subiendo a", base or "(simulacro)")
    ultimo = [u for u in cargar("ultimo_llamado") if u["acto"] in permitidos]
    if not a.forzar and not a.dry_run:
        antes = leer_existentes(base, clave, "actos", permitidos)
        n0 = len(actos)
        actos = no_empeorar(actos, antes, lambda f: f["acto"], puntuacion_acto)
        if len(actos) < n0:
            print(f"  {n0 - len(actos)} actos ya estaban mas completos en Supabase: no se tocan (usa --forzar para sobrescribir)")
    upsert(base, clave, "actos", actos, a.dry_run)
    upsert(base, clave, "cuerpos", cargar("cuerpos"), a.dry_run)
    upsert(base, clave, "especialidades", cargar("especialidades"), a.dry_run)
    upsert(base, clave, "localidades", cargar("localidades"), a.dry_run)
    for f in sorted(glob.glob(os.path.join(a.carpeta, "vacantes_*.json"))):
        curso = os.path.basename(f)[len("vacantes_"):-5]
        if cursos and curso not in cursos:
            continue
        filas = [v for v in json.load(open(f, encoding="utf-8")) if v["acto"] in permitidos]
        # "ofertada" es el estado mas pobre: solo se inserta si la vacante es nueva; adjudicada / no adjudicada sobrescriben
        upsert(base, clave, "vacantes", [v for v in filas if v["estado"] == "ofertada"], a.dry_run, solo_nuevas=not a.forzar)
        upsert(base, clave, "vacantes", [v for v in filas if v["estado"] != "ofertada"], a.dry_run)
    if not a.forzar and not a.dry_run:
        antes_u = leer_existentes(base, clave, "ultimo_llamado", {u["acto"] for u in ultimo})
        ultimo = no_empeorar(ultimo, antes_u, lambda f: (f["acto"], f["cuerpo_cod"], f["esp"]), puntuacion_ultimo)
    upsert(base, clave, "ultimo_llamado", ultimo, a.dry_run)
    if a.personas:
        if os.path.exists(a.personas):
            cargar_personas(base, clave, a.personas, a.dry_run)
        else:
            print("  (no hay fichero de personas; se omite la busqueda por nombre)")
    print("Listo.")


if __name__ == "__main__":
    main()
