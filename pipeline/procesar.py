#!/usr/bin/env python3
"""PDF de Educaragon  ->  tablas PUBLICAS y ANONIMIZADAS (JSON).

Uso:
    python3 procesar.py CARPETA_CON_PDF --salida ../web/data [--coords ../datos/coords.json]

Lo que sale (todo sin nombres ni DNI):
    actos.json, especialidades.json, localidades.json, vacantes.json, ultimo_llamado.json, meta.json

Los nombres y NIF solo se usan en memoria para cruzar "quien fue adjudicado" con "su puesto en la
lista" (clave de orden). Nunca se escriben en los ficheros de salida PUBLICOS.

Unica excepcion, solo si se pide con --personas FICHERO: los candidatos del curso (nombre, DNI parcial y puesto en
cada lista) para la busqueda privada «Mi nombre en las listas». Ese fichero NO es publico: va a una tabla de
Supabase que la web no puede leer, y el programa se niega a escribirlo dentro de la carpeta web/.

Clave de orden de la lista (estable entre semanas, comprobado con los datos de 2026):
    lista (1/2) + fecha del bloque + bloque + orden dentro del bloque
    -> texto 'L-AAAAMMDD-BBB-OOOOO', que se ordena alfabeticamente igual que la lista oficial.
"""
import argparse
import collections
import concurrent.futures as cf
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parsers as P  # noqa: E402

TIPOS_VACANTE = {
    "adjudicadas_ord": ("adjudicada", 0),
    "adjudicadas_sing": ("adjudicada", 1),
    "ofertadas_ord": ("ofertada", 0),
    "ofertadas_sing": ("ofertada", 1),
    "no_adjudicadas": ("no_adjudicada", None),   # singular se decide por el titulo
}
CUERPO_ACTO = {"PRI": "maestros", "SEC": "secundaria"}
# localidades cuyas coordenadas son aproximadas (no salian bien en el geocodificador)
COORDS_APROX = {"MEDIANA DE ARAGON", "MONTANUY", "PAULES DE SARSA", "PUIGMORENO", "MOVERA", "PASTRIZ",
                "POYO DEL CID (EL)", "VILLANUEVA DE HUERVA", "SABIÑAN"}


def clave(lista, fecha_iso, bloque, orden):
    return f"{int(lista)}-{fecha_iso.replace('-', '')}-{int(bloque):03d}-{int(orden):05d}"


def curso_de(fecha_iso):
    y, m = int(fecha_iso[:4]), int(fecha_iso[5:7])
    y0 = y if m >= 7 else y - 1
    return f"{y0}-{(y0 + 1) % 100:02d}"


def leer_pdf(ruta):
    """Lee un PDF y devuelve su informacion (en un proceso aparte para ir mas rapido)."""
    t = P.texto(ruta)
    cab = P.cabecera(t)
    tipo = P.clasificar(t)
    filas = None
    if tipo == "candidatos":
        filas = P.candidatos(t)
    elif tipo in TIPOS_VACANTE:
        filas = P.adjudicados(t)
    singular_titulo = "SINGULARIZADAS" in t[:3000].upper()
    return {"ruta": ruta, "tipo": tipo, "cab": cab, "filas": filas, "titulo_singular": singular_titulo,
            "fecha_pdf": P.fecha_pdf(ruta)}


def buscar_pdfs(carpeta):
    vistos, rutas = set(), []
    for dp, _, fs in os.walk(carpeta):
        for f in sorted(fs):
            if not f.lower().endswith(".pdf"):
                continue
            r = os.path.join(dp, f)
            h = hashlib.sha256(open(r, "rb").read()).hexdigest()
            if h not in vistos:
                vistos.add(h)
                rutas.append(r)
    return rutas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("carpeta")
    ap.add_argument("--salida", required=True)
    ap.add_argument("--coords", default=os.path.join(os.path.dirname(__file__), "..", "datos", "coords.json"))
    ap.add_argument("--desde", default="", help="solo actos con fecha >= AAAA-MM-DD (por defecto todos)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--desde-validar", default="2026-08-01", help="con --validar: solo semanas desde esta fecha")
    ap.add_argument("--validar", action="store_true", help="prueba de la reconstruccion del ultimo llamado (no genera ficheros)")
    ap.add_argument("--personas", help="ademas, escribe aqui (JSON PRIVADO, nunca dentro de web/) los candidatos para la busqueda por nombre")
    a = ap.parse_args()
    if a.personas and "/web/" in os.path.abspath(a.personas).replace("\\", "/").lower() + "/":
        sys.exit("--personas contiene nombres de personas: no se puede guardar dentro de la carpeta web/ (se publica en internet).")
    os.makedirs(a.salida, exist_ok=True)
    t0 = time.time()

    rutas = buscar_pdfs(a.carpeta)
    print(f"{len(rutas)} PDF distintos", flush=True)
    with cf.ProcessPoolExecutor(a.workers) as ex:
        leidos = list(ex.map(leer_pdf, rutas, chunksize=4))
    print("leidos en %.0fs" % (time.time() - t0), flush=True)

    # --- 1. quedarse con los documentos de interinos y una version por (tipo, acto)
    mejor = {}
    descartados = collections.Counter()
    for d in leidos:
        tipo, cab = d["tipo"], d["cab"]
        if d["filas"] is None or not cab["acto"]:
            continue
        if cab["colectivo"] == "funcionarios":
            descartados["funcionarios (carrera/practicas)"] += 1
            continue
        if a.desde and cab["fecha"] and cab["fecha"] < a.desde:
            continue
        k = (tipo, cab["acto"], d["titulo_singular"] if tipo == "no_adjudicadas" else None)
        n = len(d["filas"])
        if k not in mejor or (n, d["fecha_pdf"] or "") > (len(mejor[k]["filas"]), mejor[k]["fecha_pdf"] or ""):
            mejor[k] = d
    print("documentos usados:", collections.Counter(k[0] for k in mejor), "descartados:", dict(descartados))

    por_acto = collections.defaultdict(dict)
    for (tipo, acto, sing), d in mejor.items():
        por_acto[acto][(tipo, sing)] = d

    # Posicion (clave) de cada persona en cada lista, vista en cualquier listado de candidatos. Como la clave es
    # estable entre semanas, sirve para reconstruir el "ultimo llamado" de una semana cuyo listado de
    # candidatos no se publico (o no se pudo bajar). Los nombres solo viven en memoria.
    historial = collections.defaultdict(dict)       # (nif, nombre) -> {(cuerpo, esp): clave}
    historial_por_acto = collections.defaultdict(lambda: collections.defaultdict(dict))
    for (tipo, acto_h, _), d in mejor.items():
        if tipo != "candidatos":
            continue
        for r in d["filas"]:
            f = r["fecha"]
            k = clave(r["lista"], f"{f[6:]}-{f[3:5]}-{f[:2]}", r["bloque"], r["orden_bloque"])
            historial[(r["nif"], r["nombre"])][(r["cuerpo_cod"], r["especialidad_cod"])] = k
            historial_por_acto[acto_h][(r["nif"], r["nombre"])][(r["cuerpo_cod"], r["especialidad_cod"])] = k

    if a.personas:
        n_personas = escribir_personas(a.personas, mejor)
        print(f"personas (privado): {n_personas} filas en {a.personas}")

    def reconstruir(v_act_, excluir=None):
        """Ultimo llamado por lista usando solo el historial de otras semanas."""
        ll, sr = collections.defaultdict(list), collections.Counter()
        for v in v_act_.values():
            if v["estado"] != "adjudicada" or v["singular"] or not v["_nif"]:
                continue
            listas = {}
            for a_h, por in historial_por_acto.items():
                if a_h != excluir and v["_nif"] in por:
                    listas.update(por[v["_nif"]])
            k = listas.get((v["cuerpo_cod"], v["esp"]))
            if k:
                ll[(v["cuerpo_cod"], v["esp"])].append((k, None, 0))
                continue
            mismo = [(c, e, k2) for (c, e), k2 in listas.items() if c == v["cuerpo_cod"]]
            if len(mismo) == 1:
                ll[(mismo[0][0], mismo[0][1])].append((mismo[0][2], None, 1))
            else:
                sr[(v["cuerpo_cod"], v["esp"])] += 1
        return ll, sr

    if a.validar:
        # Prueba: en las semanas que SI tienen candidatos, reconstruir sin mirar los de esa semana y comparar.
        iguales = total = 0
        for acto_v in sorted(por_acto):
            docs_v = por_acto[acto_v]
            if ("candidatos", None) not in docs_v or not any(t.startswith("adjudicadas") for (t, _) in docs_v):
                continue
            if (docs_v[("candidatos", None)]["cab"]["fecha"] or "") < a.desde_validar:
                continue
            va = {}
            for (tipo, sing), d in docs_v.items():
                if tipo != "adjudicadas_ord":
                    continue
                for r in d["filas"]:
                    va[r["vacante"]] = {"estado": "adjudicada", "singular": 0, "cuerpo_cod": r["cuerpo_cod"],
                                        "esp": r.get("especialidad_cod"), "_nif": (r.get("nif"), r.get("nombre"))}
            real = collections.defaultdict(list)
            ll_rec, _ = reconstruir(va, excluir=acto_v)
            # "real" = el mismo calculo pero con los candidatos de esa semana
            por_p = historial_por_acto[acto_v]
            for v in va.values():
                listas = por_p.get(v["_nif"], {})
                k = listas.get((v["cuerpo_cod"], v["esp"]))
                if k:
                    real[(v["cuerpo_cod"], v["esp"])].append((k, None, 0))
            for lista_ in ll_rec:
                if lista_ in real:
                    total += 1
                    iguales += max(ll_rec[lista_], key=lambda x: x[0])[0] == max(real[lista_], key=lambda x: x[0])[0]
        print(f"VALIDACION: la reconstruccion acierta el ultimo llamado en {iguales} de {total} listas-semana ({100 * iguales / max(total, 1):.0f} %)")
        return

    actos, vacantes, ultimo = [], [], []
    especialidades = {}
    cuerpos = {}
    for acto in sorted(por_acto):
        docs = por_acto[acto]
        fechas = [d["cab"]["fecha"] for d in docs.values() if d["cab"]["fecha"]]
        if not fechas:
            continue
        fecha_oferta = min(fechas)
        adj_docs = [d for (t, s), d in docs.items() if t.startswith("adjudicadas")]
        fecha_adj = max((d["fecha_pdf"] for d in adj_docs if d["fecha_pdf"]), default=None)
        cuerpo_acto = CUERPO_ACTO.get(acto[:3], acto[:3])

        # --- 2. vacantes (ofertada -> adjudicada / no adjudicada)
        v_act = {}
        for (tipo, sing), d in docs.items():
            if tipo not in TIPOS_VACANTE:
                continue
            estado, singular = TIPOS_VACANTE[tipo]
            if singular is None:
                singular = 1 if d["titulo_singular"] else 0
            for r in d["filas"]:
                id_ = f"{acto}|{r['cuerpo_cod']}|{'S' if singular else 'O'}|{r['vacante']}"
                prev = v_act.get(id_)
                orden = {"ofertada": 0, "no_adjudicada": 1, "adjudicada": 2}
                if prev and orden[prev["estado"]] >= orden[estado]:
                    continue
                if r.get("especialidad_cod") and r.get("especialidad"):
                    especialidades[(r["cuerpo_cod"], r["especialidad_cod"])] = r["especialidad"]
                v_act[id_] = {
                    "id": id_, "acto": acto, "curso": curso_de(fecha_oferta),
                    "cuerpo_cod": r["cuerpo_cod"], "esp": r.get("especialidad_cod"),
                    "vacante": int(r["vacante"]), "singular": singular, "estado": estado,
                    "centro_cod": r["centro_cod"], "centro": r["centro"], "localidad": r["localidad"],
                    "provincia": r["provincia"], "jornada": r.get("jornada"), "duracion": r.get("duracion"),
                    "obligacion": r.get("obligacion"), "causa": r.get("causa"),
                    "perfilada": r.get("perfilada"), "perfil": r.get("perfil"),
                    "fecha_fin_estimada": _iso(r.get("fecha_fin_estimada")),
                    "_nif": (r.get("nif"), r.get("nombre")) if estado == "adjudicada" else None,
                }
        vacantes.extend(v_act.values())

        # --- 3. ultimo llamado por lista/especialidad (solo vacantes ordinarias)
        cand = docs.get(("candidatos", None))
        convocados = {}      # (cuerpo, esp) -> lista de (clave, relacion)
        por_persona = collections.defaultdict(list)   # (nif,nombre) -> [(cuerpo, esp, clave, relacion)]
        if cand:
            for r in cand["filas"]:
                f = r["fecha"]
                fiso = f"{f[6:]}-{f[3:5]}-{f[:2]}"
                k = clave(r["lista"], fiso, r["bloque"], r["orden_bloque"])
                especialidades[(r["cuerpo_cod"], r["especialidad_cod"])] = r["especialidad"]
                cuerpos[r["cuerpo_cod"]] = r["cuerpo_nombre"]
                convocados.setdefault((r["cuerpo_cod"], r["especialidad_cod"]), []).append((k, int(r["relacion"])))
                por_persona[(r["nif"], r["nombre"])].append((r["cuerpo_cod"], r["especialidad_cod"], k, int(r["relacion"])))
        llamados = collections.defaultdict(list)  # (cuerpo, esp_lista) -> [(clave, relacion, cruzada)]
        sin_resolver = collections.Counter()
        reconstruido = not cand and bool(adj_docs)
        if reconstruido:
            llamados, sin_resolver = reconstruir(v_act)
        for v in v_act.values():
            if v["estado"] != "adjudicada" or v["singular"] or not v["_nif"] or not cand:
                continue
            filas_p = por_persona.get(v["_nif"], [])
            propias = [x for x in filas_p if x[0] == v["cuerpo_cod"] and x[1] == v["esp"]]
            if propias:
                _, e, k, rel = propias[0]
                llamados[(v["cuerpo_cod"], e)].append((k, rel, 0))
            else:
                # adjudicado en una especialidad distinta a la de su lista (afinidad): solo si no hay duda
                mismo_cuerpo = [x for x in filas_p if x[0] == v["cuerpo_cod"]]
                if len(mismo_cuerpo) == 1:
                    _, e, k, rel = mismo_cuerpo[0]
                    llamados[(v["cuerpo_cod"], e)].append((k, rel, 1))
                else:
                    sin_resolver[(v["cuerpo_cod"], v["esp"])] += 1
        n_ofert = collections.Counter((v["cuerpo_cod"], v["esp"]) for v in v_act.values() if not v["singular"])
        n_adj = collections.Counter((v["cuerpo_cod"], v["esp"]) for v in v_act.values()
                                    if not v["singular"] and v["estado"] == "adjudicada")
        claves_ult = set(convocados) | set(llamados) | set(sin_resolver) | set(n_adj)
        for (cu, esp) in sorted(x for x in claves_ult if x[1]):
            conv = convocados.get((cu, esp), [])
            ll = llamados.get((cu, esp), [])
            top = max(ll, key=lambda x: x[0]) if ll else None
            ultimo.append({
                "acto": acto, "cuerpo_cod": cu, "esp": esp,
                "convocados": len(conv) or None,
                "clave_max_convocado": max(conv)[0] if conv else None,
                "vacantes": n_ofert.get((cu, esp), 0) or None,
                "adjudicadas": n_adj.get((cu, esp), 0),
                "llamados": len(ll) if (cand or reconstruido) else None,
                "llamados_otra_esp": sum(1 for x in ll if x[2]) if (cand or reconstruido) else None,
                "reconstruido": True if reconstruido else None,
                "sin_resolver": sin_resolver.get((cu, esp), 0),
                "clave_ultimo": top[0] if top else None,
                "relacion_ultimo": top[1] if top else None,
            })

        actos.append({
            "acto": acto, "cuerpo": cuerpo_acto, "fecha_oferta": fecha_oferta, "fecha_adjudicacion": fecha_adj,
            "curso": curso_de(fecha_oferta),
            "n_ofertadas": 0,   # se rellena abajo (ofertadas + las que luego se adjudicaron)
            "n_adjudicadas": sum(1 for v in v_act.values() if v["estado"] == "adjudicada"),
            "n_singulares_adjudicadas": sum(1 for v in v_act.values() if v["estado"] == "adjudicada" and v["singular"]),
            "n_no_adjudicadas": sum(1 for v in v_act.values() if v["estado"] == "no_adjudicada"),
            "n_convocados": sum(len(x) for x in convocados.values()) or None,
            "tiene_candidatos": bool(cand),
            "tiene_adjudicadas": bool(adj_docs),
        })
    # ofertadas: contar tambien las que luego se adjudicaron
    for ac in actos:
        ac["n_ofertadas"] = sum(1 for v in vacantes if v["acto"] == ac["acto"] and not v["singular"])
    for v in vacantes:
        v.pop("_nif", None)

    # --- 4. localidades con coordenadas
    coords = json.load(open(a.coords, encoding="utf-8"))
    locs = sorted({(v["localidad"], v["provincia"]) for v in vacantes})
    localidades, sin_coords = [], []
    for loc, prov in locs:
        c = coords.get(loc)
        if not c:
            sin_coords.append(loc)
        localidades.append({"localidad": loc, "provincia": prov, "lat": c[0] if c else None,
                            "lon": c[1] if c else None, "aprox": loc in COORDS_APROX})
    if sin_coords:
        print("AVISO localidades sin coordenadas (anadelas a datos/coords.json):", sin_coords)

    esp_rows = [{"cuerpo_cod": c, "cod": e, "nombre": n} for (c, e), n in sorted(especialidades.items())]
    tablas = [("actos", actos), ("cuerpos", [{"cod": c, "nombre": n} for c, n in sorted(cuerpos.items())]), ("especialidades", esp_rows), ("localidades", localidades),
              ("ultimo_llamado", ultimo)]
    cursos = sorted({x["curso"] for x in actos})
    for c in cursos:   # las vacantes van en un fichero por curso para que la web cargue solo lo que necesita
        tablas.append((f"vacantes_{c}", [v for v in vacantes if v["curso"] == c]))
    for nombre, filas in tablas:
        with open(os.path.join(a.salida, nombre + ".json"), "w", encoding="utf-8") as f:
            json.dump([{k: v for k, v in r.items() if v is not None} for r in filas], f,
                      ensure_ascii=False, separators=(",", ":"))
    meta = {"generado": time.strftime("%Y-%m-%d %H:%M:%S"), "cursos": cursos, "actos": len(actos),
            "vacantes": len(vacantes),
            "ultimo_llamado": len(ultimo), "localidades": len(localidades),
            "ultimo_acto": max((x["fecha_oferta"] for x in actos), default=None)}
    json.dump(meta, open(os.path.join(a.salida, "meta.json"), "w"), indent=1)
    print(meta, "en %.0fs" % (time.time() - t0))


def escribir_personas(ruta, mejor):
    """Candidatos de los listados: una fila por persona y especialidad con su puesto en la lista (estable entre semanas)."""
    filas = {}
    for (tipo, _acto, _), d in sorted(mejor.items(), key=lambda kv: kv[1]["cab"]["fecha"] or ""):
        if tipo != "candidatos" or not d["cab"]["fecha"]:
            continue
        curso = curso_de(d["cab"]["fecha"])
        for r in d["filas"]:
            f = r["fecha"]
            filas[(curso, r["nif"], r["nombre"], r["cuerpo_cod"], r["especialidad_cod"])] = clave(
                r["lista"], f"{f[6:]}-{f[3:5]}-{f[:2]}", r["bloque"], r["orden_bloque"])
    salida = [{"curso": c, "nombre": n, "nif": nif, "cuerpo_cod": cu, "esp": e, "clave": k}
              for (c, nif, n, cu, e), k in sorted(filas.items())]
    os.makedirs(os.path.dirname(os.path.abspath(ruta)), exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, separators=(",", ":"))
    return len(salida)


def _iso(dmy):
    if not dmy or len(dmy) != 10:
        return None
    return f"{dmy[6:]}-{dmy[3:5]}-{dmy[:2]}"


if __name__ == "__main__":
    main()
