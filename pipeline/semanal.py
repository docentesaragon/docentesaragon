#!/usr/bin/env python3
"""Ciclo semanal completo:  bajar PDF nuevos de Educaragón  ->  leerlos  ->  subirlos a Supabase.

    python3 semanal.py                 # baja y procesa los ultimos 21 dias (no sube nada)
    python3 semanal.py --subir         # ademas sube a Supabase (necesita SUPABASE_URL y SUPABASE_SERVICE_KEY)
    python3 semanal.py --pdfs CARPETA  # no descarga: procesa una carpeta de PDF que ya tengas

Requisitos: Python 3.9+, pypdf (pip install pypdf) y pdftotext/pdfinfo de Poppler.
Los PDF (con nombres de personas) se guardan en una carpeta temporal y NO se suben a ningún sitio.
Con --subir, además:
  · lee los PDF que el administrador haya subido desde la web (bucket privado «aragon-pdf») y los borra al terminar;
  · guarda en una tabla PRIVADA de Supabase los candidatos del curso (nombre normalizado y puesto en la lista), para que cada
    persona pueda encontrar sus listas escribiendo su nombre. Esa tabla no la puede leer la web.
"""
import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import subidos  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))


def ejecutar(args, **kw):
    print("$", " ".join(args), flush=True)
    return subprocess.run([sys.executable, "-u"] + args, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=21, help="cuantos dias hacia atras buscar (def. 21)")
    ap.add_argument("--pdfs", help="carpeta de PDF ya descargados (omite la descarga)")
    ap.add_argument("--salida", help="carpeta para los JSON (por defecto una temporal)")
    ap.add_argument("--subir", action="store_true", help="sube el resultado a Supabase")
    a = ap.parse_args()

    if shutil.which("pdftotext") is None:
        sys.exit("Falta pdftotext (Poppler). Linux: sudo apt install poppler-utils · Windows: winget install oschwartz10612.Poppler")
    tmp = tempfile.mkdtemp(prefix="interinos_aragon_")
    pdfs = a.pdfs or os.path.join(tmp, "pdfs")
    salida = a.salida or os.path.join(tmp, "json")
    os.makedirs(salida, exist_ok=True)

    subidos_admin = []
    if not a.pdfs:
        desde = (dt.date.today() - dt.timedelta(days=a.dias)).isoformat()
        # el robot sale con codigo 1 si alguna pagina falla; lo importante es si llego algun PDF
        ejecutar([os.path.join(AQUI, "descargar_educaragon.py"), "--salida", pdfs, "--desde", desde])
        if a.subir:
            subidos_admin = subidos.bajar(pdfs)
    n = sum(f.lower().endswith(".pdf") for _, _, fs in os.walk(pdfs) for f in fs) if os.path.isdir(pdfs) else 0
    print(f"PDF disponibles: {n}")
    if n == 0:
        sys.exit("No se ha descargado ningun PDF (Educaragon no responde o ha cambiado las paginas). Nada que procesar.")

    personas = os.path.join(tmp, "privado", "personas.json")     # NUNCA dentro de web/: lleva nombres
    r = ejecutar([os.path.join(AQUI, "procesar.py"), pdfs, "--salida", salida, "--desde", ""] + (["--personas", personas] if a.subir else []))
    if r.returncode:
        sys.exit("Fallo al leer los PDF.")
    if a.subir:
        r = ejecutar([os.path.join(AQUI, "cargar_supabase.py"), salida] + (["--personas", personas] if os.path.exists(personas) else []))
        if r.returncode:
            sys.exit("Fallo al subir a Supabase.")
        subidos.borrar(subidos_admin)     # ya procesados: fuera del bucket
    else:
        print("JSON en", salida, "(usa --subir para enviarlos a Supabase)")
    if not a.pdfs:
        shutil.rmtree(pdfs, ignore_errors=True)   # no dejar nombres de personas en disco
    shutil.rmtree(os.path.dirname(personas), ignore_errors=True)
    print("Terminado.")


if __name__ == "__main__":
    main()
