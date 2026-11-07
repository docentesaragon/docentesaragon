#!/usr/bin/env python3
"""Puerta horaria de los reintentos del robot semanal (la usa .github/workflows/semanal.yml).

GitHub programa las tareas en hora UTC, pero Aragón cambia de hora dos veces al año (UTC+1 en invierno, UTC+2 en verano).
Para que los reintentos caigan siempre entre las 14:00 y las 17:59 de Aragón, el workflow se dispara cada hora entre las 12 y las 16 UTC
y esta puerta deja pasar solo las ejecuciones que, en hora de Aragón, estén en el tramo permitido:

    invierno (UTC+1):  13 UTC = 14 h ✔   14 = 15 h ✔   15 = 16 h ✔   16 = 17 h ✔   12 = 13 h ✘
    verano   (UTC+2):  12 UTC = 14 h ✔   13 = 15 h ✔   14 = 16 h ✔   15 = 17 h ✔   16 = 18 h ✘

Las demás ejecuciones (la de siempre de la tarde, la del domingo y las lanzadas a mano) no pasan por la puerta: siempre siguen.

    python3 puerta_horaria.py --reintento          # escribe seguir=si|no en $GITHUB_OUTPUT (y en pantalla)
    python3 puerta_horaria.py                      # (sin --reintento) siempre «si»
    python3 puerta_horaria.py --reintento --ahora 2026-11-06T13:05:00+00:00   # para probar
"""
import argparse
import datetime as dt
import os
import sys
from zoneinfo import ZoneInfo

DESDE, HASTA = 14, 17          # horas de Aragón, ambas incluidas (14:00 a 17:59)
ZONA = ZoneInfo("Europe/Madrid")


def permitido(reintento, ahora=None):
    """(seguir, hora_en_aragon). `ahora` debe llevar zona horaria; por defecto, el momento actual."""
    ahora = (ahora or dt.datetime.now(dt.timezone.utc)).astimezone(ZONA)
    return (not reintento) or DESDE <= ahora.hour <= HASTA, ahora


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reintento", action="store_true", help="esta ejecución es uno de los reintentos horarios de la tarde")
    ap.add_argument("--ahora", help="momento ISO 8601 con zona (solo para pruebas)")
    a = ap.parse_args()
    ahora = dt.datetime.fromisoformat(a.ahora) if a.ahora else None
    if ahora is not None and ahora.tzinfo is None:
        sys.exit("--ahora necesita zona horaria, p. ej. 2026-11-06T13:05:00+00:00")
    seguir, local = permitido(a.reintento, ahora)
    if a.reintento:
        print(f"Son las {local:%H:%M} en Aragón: " + (f"dentro del tramo {DESDE}:00-{HASTA}:59, el robot sigue." if seguir else f"fuera del tramo {DESDE}:00-{HASTA}:59 (esta pasada es solo por el cambio de hora), no se hace nada."))
    else:
        print(f"Son las {local:%H:%M} en Aragón: ejecución normal, el robot sigue.")
    salida = os.environ.get("GITHUB_OUTPUT")
    if salida:
        with open(salida, "a", encoding="utf-8") as f:
            f.write("seguir=" + ("si" if seguir else "no") + "\n")
    print("seguir=" + ("si" if seguir else "no"))


if __name__ == "__main__":
    main()
