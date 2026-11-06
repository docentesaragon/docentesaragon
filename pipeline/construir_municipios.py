#!/usr/bin/env python3
"""Construye web/data/municipios.json (municipios de España con coordenadas) para elegir «dónde vives» y calcular distancias.

Fuente: https://github.com/dr5hn/countries-states-cities-database (licencia ODbL 1.0), fichero contributions/cities/ES.json.
    python3 pipeline/construir_municipios.py RUTA/contributions/cities/ES.json [web/data/municipios.json]
En Aragón se usan las coordenadas de web/data/localidades.json (las de la web) y se añaden las localidades que la fuente no trae,
para que la distancia a un centro de tu propio pueblo salga 0 km. Solo hace falta ejecutarlo si quieres refrescar la lista; el resultado ya va en el paquete.
"""
import json
import math
import os
import re
import sys
import unicodedata

PROVINCIAS = {   # código de la fuente -> nombre
    "VI": "Álava", "AB": "Albacete", "A": "Alicante", "AL": "Almería", "O": "Asturias", "AV": "Ávila", "BA": "Badajoz", "PM": "Baleares",
    "B": "Barcelona", "BI": "Vizcaya", "BU": "Burgos", "CC": "Cáceres", "CA": "Cádiz", "S": "Cantabria", "CS": "Castellón", "CE": "Ceuta",
    "CR": "Ciudad Real", "CO": "Córdoba", "C": "A Coruña", "CU": "Cuenca", "SS": "Guipúzcoa", "GI": "Girona", "GR": "Granada",
    "GU": "Guadalajara", "H": "Huelva", "HU": "Huesca", "J": "Jaén", "LO": "La Rioja", "GC": "Las Palmas", "LE": "León", "L": "Lleida",
    "LU": "Lugo", "M": "Madrid", "MA": "Málaga", "ML": "Melilla", "MU": "Murcia", "NA": "Navarra", "OR": "Ourense", "P": "Palencia",
    "PO": "Pontevedra", "SA": "Salamanca", "TF": "Santa Cruz de Tenerife", "SG": "Segovia", "SE": "Sevilla", "SO": "Soria",
    "T": "Tarragona", "TE": "Teruel", "TO": "Toledo", "V": "Valencia", "VA": "Valladolid", "Z": "Zaragoza", "ZA": "Zamora",
}


def norm(t):
    t = unicodedata.normalize("NFD", t.upper())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").replace("-", " ").replace("'", " ")
    m = re.match(r"^(.*?)\s*\((EL|LA|LOS|LAS|L|ELS|LES|O|A|AS|OS)\)$", t)
    if m:
        t = m.group(2) + " " + m.group(1)
    return re.sub(r"\s+", " ", t).strip()


def bonito(t):
    menores = {"de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "al"}
    m = re.match(r"^(.*?)\s*\((EL|LA|LOS|LAS)\)$", t)
    if m:
        t = m.group(2) + " " + m.group(1)
    return "".join(w if i and w in menores else w[:1].upper() + w[1:] for i, w in enumerate(re.split(r"(\s+|-)", t.lower())))


def km(a, b):
    f1, f2 = math.radians(a[0]), math.radians(b[0])
    x = math.sin((f2 - f1) / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


def completar_aragon(lista, nombres, idx, ruta_loc):
    """Pone las coordenadas de localidades.json en los municipios de Aragón y añade los que faltan."""
    locs = json.load(open(ruta_loc, encoding="utf-8"))
    por = {}
    for i, (n, p, _la, _lo) in enumerate(lista):
        if nombres[p] in ("Huesca", "Teruel", "Zaragoza"):
            for parte in n.split("/"):
                por.setdefault((norm(parte), nombres[p].upper()), []).append(i)
    cambiados = anadidos = 0
    for l in locs:
        punto = (round(l["lat"], 4), round(l["lon"], 4))
        prov = idx[l["provincia"].capitalize()]
        k = (norm(l["localidad"]), l["provincia"])
        if k in por:
            for i in por[k]:
                lista[i][2], lista[i][3] = punto
            cambiados += 1
            continue
        # ¿es un barrio o anejo de un municipio que ya está? (mismo comienzo y a menos de 5 km): no se duplica
        base = norm(l["localidad"])
        if any(nombres[p] == l["provincia"].capitalize() and (norm(n).startswith(base) or base.startswith(norm(n))) and km(punto, (la, lo)) < 5
               for n, p, la, lo in lista):
            continue
        lista.append([bonito(l["localidad"]), prov, *punto])
        anadidos += 1
    return cambiados, anadidos


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    salida = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "data", "municipios.json")
    filas = json.load(open(sys.argv[1], encoding="utf-8"))
    nombres = sorted(PROVINCIAS.values(), key=lambda t: t.lower())
    idx = {n: i for i, n in enumerate(nombres)}
    vistos, lista = set(), []
    for c in filas:
        if c.get("type") not in ("municipality", "city", "locality") or c.get("state_code") not in PROVINCIAS:
            continue
        try:
            lat, lon = round(float(c["latitude"]), 4), round(float(c["longitude"]), 4)
        except (TypeError, ValueError, KeyError):
            continue
        nombre = " ".join(str(c["name"]).split())
        prov = idx[PROVINCIAS[c["state_code"]]]
        if not nombre or (nombre.lower(), prov) in vistos:
            continue
        vistos.add((nombre.lower(), prov))
        lista.append([nombre, prov, lat, lon])
    ruta_loc = os.path.join(os.path.dirname(os.path.abspath(salida)), "localidades.json")
    if os.path.exists(ruta_loc):
        c, a = completar_aragon(lista, nombres, idx, ruta_loc)
        print(f"Aragón: {c} localidades con las coordenadas de la web, {a} añadidas")
    lista.sort(key=lambda r: (r[0].lower(), r[1]))
    datos = {"fuente": "countries-states-cities-database (ODbL 1.0), https://github.com/dr5hn/countries-states-cities-database",
             "provincias": nombres, "m": lista}
    with open(salida, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(lista)} municipios -> {salida} ({os.path.getsize(salida) // 1024} KB)")


if __name__ == "__main__":
    main()
