#!/usr/bin/env python3
"""PDF que el administrador sube desde la web («Mi seguimiento > Administración > Subir PDF»).

Se guardan en un bucket PRIVADO de Supabase Storage ("aragon-pdf"). El robot semanal los baja a su carpeta
temporal, los procesa como cualquier otro PDF de Educaragón y, cuando todo ha ido bien, los borra del bucket.

    python3 subidos.py listar                 # nombres de los PDF pendientes
    python3 subidos.py bajar CARPETA          # los descarga en CARPETA/subidos/
    python3 subidos.py borrar nombre1 nombre2 # los borra del bucket

Usa SUPABASE_URL y SUPABASE_SERVICE_KEY (los mismos secretos del resto del robot). Sin dependencias.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "aragon-pdf"


def _credenciales():
    base = os.environ.get("SUPABASE_URL", "").strip().strip("\"'").strip().rstrip("/")
    if base.endswith("/rest/v1"):
        base = base[: -len("/rest/v1")]
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    clave = os.environ.get("SUPABASE_SERVICE_KEY", "").strip().strip("\"'").strip()
    return base, clave


def _pedir(base, clave, metodo, ruta, datos=None):
    cab = {"apikey": clave, "Authorization": "Bearer " + clave}
    cuerpo = None
    if datos is not None:
        cab["Content-Type"] = "application/json"
        cuerpo = json.dumps(datos).encode("utf-8")
    req = urllib.request.Request(f"{base}/storage/v1/{ruta}", data=cuerpo, headers=cab, method=metodo)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def listar(base=None, clave=None):
    base, clave = (base, clave) if base else _credenciales()
    nombres, off = [], 0
    while True:
        lote = json.loads(_pedir(base, clave, "POST", f"object/list/{BUCKET}",
                                 {"prefix": "", "limit": 100, "offset": off, "sortBy": {"column": "name", "order": "asc"}}) or "[]")
        # las "carpetas" vienen sin id; los PDF subidos desde la web van en la raiz
        nombres.extend(o["name"] for o in lote if o.get("id") and o["name"].lower().endswith(".pdf"))
        if len(lote) < 100:
            return nombres
        off += 100


def bajar(carpeta, base=None, clave=None):
    """Descarga los PDF pendientes en carpeta/subidos/. Devuelve la lista de nombres bajados.
    Si algo falla (bucket sin crear, red...) avisa y sigue: el robot no debe romperse por esto."""
    base, clave = (base, clave) if base else _credenciales()
    try:
        nombres = listar(base, clave)
        destino = os.path.join(carpeta, "subidos")
        os.makedirs(destino, exist_ok=True)
        hechos = []
        for n in nombres:
            datos = _pedir(base, clave, "GET", f"object/{BUCKET}/{urllib.parse.quote(n)}")
            if not datos.startswith(b"%PDF"):
                print(f"  AVISO: {n} no parece un PDF; se ignora", flush=True)
                continue
            seguro = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in n)
            with open(os.path.join(destino, seguro), "wb") as fh:
                fh.write(datos)
            hechos.append(n)
        print(f"PDF subidos por el administrador: {len(hechos)}", flush=True)
        return hechos
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"AVISO: no se pudieron leer los PDF subidos por el administrador ({e}). Se sigue sin ellos.", flush=True)
        return []


def borrar(nombres, base=None, clave=None):
    if not nombres:
        return
    base, clave = (base, clave) if base else _credenciales()
    try:
        _pedir(base, clave, "DELETE", f"object/{BUCKET}", {"prefixes": list(nombres)})
        print(f"PDF subidos ya procesados y borrados del bucket: {len(nombres)}", flush=True)
    except (urllib.error.URLError, OSError) as e:
        print(f"AVISO: no se pudieron borrar los PDF subidos ({e}); se procesaran otra vez la proxima vez (no pasa nada).", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("listar", "bajar", "borrar"):
        sys.exit(__doc__)
    if sys.argv[1] == "listar":
        print("\n".join(listar(*_credenciales())))
    elif sys.argv[1] == "bajar":
        bajar(sys.argv[2])
    else:
        borrar(sys.argv[2:])
