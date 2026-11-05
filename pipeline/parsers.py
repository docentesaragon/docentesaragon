"""Lectores de los PDF de Educaragon -> filas de tabla. Usa pdftotext -layout (poppler)."""
import re
import subprocess

RE_NIF = r"\*+\w{3,5}\*+"
RE_CAND = re.compile(
    r"^\s*(?P<relacion>\d+)\s+(?P<lista>\d)\s+(?P<fecha>\d\d/\d\d/\d{4})\s+(?P<bloque>\d+)\s+"
    r"(?P<orden_bloque>\d+)\s+(?P<nif>" + RE_NIF + r")\s+(?P<nombre>.+?)(?:\s{2,}(?P<resto>.*))?$")
RE_ACTO = re.compile(r"\b([A-Z]{3})\s*-\s*(\d{4})\s*-\s*(\d{1,3})\b")
RE_FECHA_ACTO = re.compile(r"FECHA:\s*(\d\d)/(\d\d)/(\d{4})")


def texto(ruta):
    return subprocess.run(["pdftotext", "-layout", ruta, "-"], capture_output=True, text=True,
                          errors="replace").stdout


def cabecera(t):
    """Acto (p. ej. PRI-2026-37), fecha de la oferta y colectivo (interinos / funcionarios).

    OJO: Educaragon reutiliza el contador del acto entre colectivos (PRI-2026-2 del 09/07 es de
    funcionarios de carrera y el del 30/07 de interinos), por eso hay que mirar el colectivo."""
    m = RE_ACTO.search(t)
    f = RE_FECHA_ACTO.search(t)
    cab = t[:3000].upper()
    if "INTERINOS" in cab:
        colectivo = "interinos"
    elif "FUNCIONARIOS" in cab:
        colectivo = "funcionarios"
    else:
        colectivo = None  # algunos listados (candidatos, no adjudicadas) no lo dicen en la cabecera
    return {"acto": f"{m.group(1)}-{m.group(2)}-{int(m.group(3))}" if m else None,
            "fecha": f"{f.group(3)}-{f.group(2)}-{f.group(1)}" if f else None,
            "colectivo": colectivo}


def fecha_pdf(ruta):
    """Fecha de creacion del PDF (AAAA-MM-DD), que coincide con el dia de publicacion/adjudicacion."""
    try:
        out = subprocess.run(["pdfinfo", ruta], capture_output=True, text=True, errors="replace").stdout
    except FileNotFoundError:
        return None
    m = re.search(r"CreationDate:\s+\w+\s+(\w+)\s+(\d+)\s+[\d:]+\s+(\d{4})", out)
    if not m:
        return None
    meses = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
             "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
    return f"{m.group(3)}-{meses[m.group(1)]:02d}-{int(m.group(2)):02d}"


def candidatos(t):
    """Una fila por candidato preseleccionado y especialidad."""
    filas, cuerpo, esp, cols = [], None, None, None
    for ln in t.splitlines():
        m = re.match(r"^CUERPO\s+(\d{4}) - (.+?)\s*$", ln)
        if m:
            cuerpo = (m.group(1), m.group(2)); continue
        m = re.match(r"^ESPECIALIDAD\s+(\S+) - (.+?)\s*$", ln)
        if m:
            esp = (m.group(1), m.group(2)); continue
        if "HUESCA" in ln and "TERUEL" in ln and "ZARAGOZA" in ln and "REFERENCIA" in ln:
            cols = {p: ln.index(p) for p in ("HUESCA", "TERUEL", "ZARAGOZA") if p in ln}
            # la primera aparicion de HUESCA es la cabecera "PROVINCIA REFERENCIA" -> usar la ultima
            cols = {p: ln.rindex(p) for p in cols}
            continue
        m = RE_CAND.match(ln)
        if m and cuerpo and esp:
            d = m.groupdict()
            resto = d.pop("resto") or ""
            prov_ref = re.search(r"\b(HUESCA|TERUEL|ZARAGOZA)\b", resto)
            susp = []
            if cols:
                base = len(ln) - len(resto) if resto else 0
                for mm in re.finditer(r"\bX\b", ln):
                    cercano = min(cols, key=lambda p: abs(cols[p] - mm.start()))
                    susp.append(cercano)
            d.update(cuerpo_cod=cuerpo[0], cuerpo_nombre=cuerpo[1], especialidad_cod=esp[0], especialidad=esp[1],
                     provincia_ref=prov_ref.group(1) if prov_ref else None,
                     suspendido_en=",".join(sorted(set(susp))) or None)
            d["nombre"] = d["nombre"].strip()
            filas.append(d)
    return filas


def adjudicados(t):
    """Vacantes (ordinarias o singulares) adjudicadas: una fila por vacante."""
    filas = []
    for blq in re.split(r"- Vacante - - Cuerpo/Especialidad -", t)[1:]:
        ls = [l for l in blq.splitlines() if l.strip()]
        if len(ls) < 3:
            continue
        r = {}
        m = re.match(r"^\s*(\d{4}) - (.+?)\s{2,}\((\d+)\)\s+(.+?)\s*$", ls[1])
        if not m:
            continue
        r["cuerpo_cod"], r["centro_cod"], r["centro"] = m.group(1), m.group(3), m.group(4)
        col = ls[1].find("(" + r["centro_cod"] + ")")
        m = re.match(r"^\s*(\d+)\s+(.+?)\s*$", ls[2][:col] if col > 0 else ls[2])
        m2 = re.match(r"^(.+?)\s*\((\w+)\)\s*$", ls[2][col:]) if col > 0 else None
        if not (m and m2):  # respaldo: separar por 2+ espacios
            m = re.match(r"^\s*(\d+)\s+(.+?)\s{2,}(.+?)\s*\((\w+)\)\s*$", ls[2])
            m2 = None
        if m and m2:
            r["vacante"], r["especialidad_txt"] = m.groups()
            r["localidad"], r["provincia"] = m2.groups()
        if m and not m2:
            r["vacante"], r["especialidad_txt"], r["localidad"], r["provincia"] = m.groups()
        if "vacante" in r:
            cod = re.match(r"^(\S+) - (.+)$", r["especialidad_txt"])
            r["especialidad_cod"], r["especialidad"] = (cod.groups() if cod else (None, r["especialidad_txt"]))
        else:
            continue
        for i, l in enumerate(ls):
            m = re.match(r"^\s*(" + RE_NIF + r") - (.+?)\s*$", l)
            if m:
                r["nif"], r["nombre"] = m.group(1), m.group(2)
            if l.strip().startswith("- Jornada -") and i + 1 < len(ls):
                v = re.split(r"\s{2,}", ls[i + 1].strip())
                r["jornada"], r["duracion"], r["obligacion"], r["causa"] = (v + [None] * 4)[:4]
            if "Fecha Final Estimada" in l and i + 1 < len(ls):
                m = re.search(r"(\d\d/\d\d/\d{4})", ls[i + 1])
                if m: r["fecha_fin_estimada"] = m.group(1)
            if l.strip().startswith("- Perfilada -") and i + 1 < len(ls):
                v = re.split(r"\s{2,}", ls[i + 1].strip())
                r["perfilada"] = v[0]; r["perfil"] = v[1] if len(v) > 1 else None
        if "vacante" in r:
            filas.append(r)
    return filas


def clasificar(t):
    """Tipo de documento segun el titulo de la primera pagina."""
    p = t[:3000].upper()
    if "CANDIDATOS PRESELECCIONADOS" in p: return "candidatos"
    if "VACANTES ORDINARIAS ADJUDICADAS" in p: return "adjudicadas_ord"
    if "VACANTES SINGULARIZADAS" in p and "ADJUDICADAS" in p: return "adjudicadas_sing"
    if "VACANTES ORDINARIAS OFERTADAS" in p: return "ofertadas_ord"
    if "VACANTES SINGULARIZADAS" in p and "OFERTADAS" in p: return "ofertadas_sing"
    if "VACANTES NO ADJUDICADAS" in p: return "no_adjudicadas"
    if "EFECTOS EN LISTA" in p: return "efectos"
    return "otro"
