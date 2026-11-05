#!/usr/bin/env python3
"""Servidor de pruebas que imita lo basico de Supabase: API REST (PostgREST con esquema "aragon"), cuentas con correo y
contrasena (alta con correo de confirmacion, entrar, recuperar contrasena) y login con Google, tablas de pases y seguimiento
con sus permisos (RLS) y la funcion "aragon-verificar-compra".
Solo para probar la carga y la web sin tocar el Supabase real.   python3 mock_supabase.py [puerto]

Control para las pruebas (no existe en Supabase):
  POST /__test/siguiente {"email": ...}   -> quien "entrara con Google" la proxima vez
  POST /__test/usuario {"email", "password", "confirmado", "cuenta"} -> crea ese usuario (por defecto confirmado, clave "clave-segura-1").
        "cuenta": "vieja" (por defecto: ya usó su prueba, sin acceso) | "nueva" (entrará y recibirá la prueba) |
                  "prueba_caducada" (entró hace 20 días y su prueba acabó ayer) | "con_prueba" (entró hace 3 días)
  POST /__test/invitado {"email", "de"}   -> ese usuario queda invitado por el usuario "de" (como si hubiera usado su código)
  POST /__test/mover_alta {"email", "dias"} -> envejece su cuenta (para probar que el código caduca a los 30 días)
  POST /__test/pase {"email", "expira", "producto", "tipo"} -> crea ese usuario con un pase (tipo: suscripcion por defecto, o pago_unico...)
  GET  /__test/estado                      -> volcado de usuarios, pases, seguimiento y correos enviados (campo "correos")
"""
import base64, datetime as dt, json, re, secrets, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ESQUEMA = "aragon"
TABLAS = {}      # nombre -> {clave: fila}   (tablas publicas)
KEY_ANON, KEY_SERVICE = "anon-test-key", "service-test-key"
USUARIOS, PASES, SEGUIMIENTO = {}, [], {}   # id -> {email, password, confirmado, meta}; lista de filas; user_id -> fila
CORREOS = []                                # "correos enviados": {para, tipo, enlace}
VERIFICACIONES = {}                         # token del enlace del correo -> (user_id, tipo); de un solo uso
CLAVE_POR_DEFECTO = "clave-segura-1"
CUENTAS = {}                                # user_id -> {codigo, alta (fecha), referido_por}  (tabla aragon.cuentas)
ACCESO, REFRESCO = {}, {}                   # token -> user_id
SIGUIENTE = {"email": "ana@test.es"}
LOG = []                                    # (metodo, ruta) de cada peticion, para las pruebas


def hoy(): return dt.datetime.now(dt.timezone.utc).date().isoformat()
def dias(n): return (dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=n)).isoformat()


def curso_de(d=None):
    d = d or dt.date.today()
    a = d.year if d.month >= 7 else d.year - 1
    return f"{a}-{(a + 1) % 100:02d}"


# ---- lo que hacen las funciones de aragon (supabase/schema.sql), con las mismas reglas ----
def nuevo_codigo():
    while True:
        c = "ARA-" + "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(5))
        if not any(x["codigo"] == c for x in CUENTAS.values()): return c


def asegurar_cuenta(uid, antiguedad=0, prueba_hasta=None):
    """Crea la cuenta con su codigo y su prueba de 15 dias (expira hoy+14). Devuelve True si la acaba de crear."""
    if uid in CUENTAS: return False
    CUENTAS[uid] = {"codigo": nuevo_codigo(), "alta": dias(-antiguedad), "referido_por": None}
    PASES.append({"id": len(PASES) + 1, "user_id": uid, "curso": curso_de(), "producto": "prueba", "tipo": "prueba", "token": None,
                  "expira": prueba_hasta or dias(14), "estado": "activo"})
    return True


def aplicar_codigo(uid, codigo):
    mia = CUENTAS.get(uid)
    if not mia: return "no_existe"
    suya = next(((u, c) for u, c in CUENTAS.items() if c["codigo"] == (codigo or "").strip().upper()), None)
    if not suya: return "no_existe"
    if suya[0] == uid: return "propio"
    if mia["referido_por"]: return "ya_usado"
    if suya[1]["referido_por"] == uid: return "circular"
    if (dt.date.today() - dt.date.fromisoformat(mia["alta"])).days > 30: return "caducado"
    mia["referido_por"] = suya[0]
    return "ok"


def pagados(uid, curso):
    return len({p["user_id"] for p in PASES if CUENTAS.get(p["user_id"], {}).get("referido_por") == uid and p["curso"] == curso
                and p["tipo"] in ("suscripcion", "pago_unico") and p["estado"] == "activo"})


def premiar(pase):
    """Trigger de la tabla pases: con 3 invitados que pagan el curso, la persona que invito recibe el curso gratis."""
    if pase["tipo"] not in ("suscripcion", "pago_unico") or pase["estado"] != "activo": return
    quien = CUENTAS.get(pase["user_id"], {}).get("referido_por")
    if quien and pagados(quien, pase["curso"]) >= 3 and not any(p["user_id"] == quien and p["tipo"] == "invitaciones" and p["curso"] == pase["curso"] for p in PASES):
        PASES.append({"id": len(PASES) + 1, "user_id": quien, "curso": pase["curso"], "producto": "invitaciones", "tipo": "invitaciones",
                      "token": None, "expira": f"20{pase['curso'][-2:]}-06-30", "estado": "activo"})


def anadir_pase(pase):
    PASES.append(pase); premiar(pase)
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")


def usuario_por_email(email, cuenta="vieja", **campos):
    """cuenta: ver arriba. Los usuarios que se registran por la web (signup) se crean con cuenta="nueva"."""
    for uid, u in USUARIOS.items():
        if u["email"] == email: return uid
    uid = secrets.token_hex(4) + "-0000-0000-0000-" + secrets.token_hex(6)
    USUARIOS[uid] = {"email": email, "password": CLAVE_POR_DEFECTO, "confirmado": True, "meta": {}, **campos}
    if cuenta == "vieja": asegurar_cuenta(uid, antiguedad=400, prueba_hasta=dias(-385))
    elif cuenta == "prueba_caducada": asegurar_cuenta(uid, antiguedad=20, prueba_hasta=dias(-1))
    elif cuenta == "con_prueba": asegurar_cuenta(uid, antiguedad=3, prueba_hasta=dias(11))
    return uid


def buscar(email):
    return next((uid for uid, u in USUARIOS.items() if u["email"] == email), None)


def enlace_correo(servidor, destino, uid, tipo):
    """Enlace del correo, como el de Supabase: /auth/v1/verify confirma y vuelve a la web con la sesion en el fragmento."""
    tok = secrets.token_hex(10); VERIFICACIONES[tok] = (uid, tipo)
    return f"{servidor}/auth/v1/verify?" + urllib.parse.urlencode({"token": tok, "type": tipo, "redirect_to": destino})


def sesion_de(uid):
    exp = int(dt.datetime.now().timestamp()) + 3600
    acceso = f"{b64({'alg': 'HS256'})}.{b64({'sub': uid, 'email': USUARIOS[uid]['email'], 'exp': exp, 'role': 'authenticated'})}.{secrets.token_hex(6)}"
    refresco = secrets.token_hex(8)
    ACCESO[acceso] = uid; REFRESCO[refresco] = uid
    return {"access_token": acceso, "refresh_token": refresco, "expires_in": 3600, "expires_at": exp, "token_type": "bearer"}


def tiene_pase(uid): return any(p["user_id"] == uid and p["estado"] == "activo" and p["expira"] >= hoy() for p in PASES)


def aplicar(filas, q):
    for col, vals in q.items():
        if col in ("select", "order", "limit", "offset", "on_conflict"): continue
        op, _, v = vals[0].partition(".")
        if op == "eq": filas = [f for f in filas if str(f.get(col)) == v]
        elif op == "gte": filas = [f for f in filas if str(f.get(col)) >= v]
        elif op == "in": filas = [f for f in filas if str(f.get(col)) in v.strip("()").split(",")]
    if "order" in q:
        col, _, sent = q["order"][0].partition(".")
        filas = sorted(filas, key=lambda f: (f.get(col) is None, f.get(col)), reverse=(sent == "desc"))
    off = int(q.get("offset", [0])[0]); lim = min(int(q.get("limit", [1000])[0]), 1000)   # tope de 1000 como Supabase
    return filas[off:off + lim]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, range, range-unit, accept-profile, content-profile, x-client-info")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "Content-Range")

    def _resp(self, code, cuerpo=b"", extra=None):
        if isinstance(cuerpo, (dict, list, str)): cuerpo = json.dumps(cuerpo).encode(); extra = {"Content-Type": "application/json", **(extra or {})}
        self.send_response(code); self._cors()
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.send_header("Content-Length", str(len(cuerpo))); self.end_headers(); self.wfile.write(cuerpo)

    def do_OPTIONS(self): self._resp(204)

    def _cuerpo(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n)) if n else None

    def _usuario(self):
        return ACCESO.get(self.headers.get("Authorization", "").replace("Bearer ", ""))

    def _perfil_ok(self):
        return (self.headers.get("Accept-Profile") or self.headers.get("Content-Profile")) == ESQUEMA

    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query); partes = u.path.strip("/").split("/")
        LOG.append(("GET", u.path))
        if u.path == "/auth/v1/verify":
            destino = q["redirect_to"][0]; uid_tipo = VERIFICACIONES.pop(q["token"][0], None)
            if not uid_tipo:
                frag = urllib.parse.urlencode({"error": "access_denied", "error_code": "otp_expired", "error_description": "Email link is invalid or has expired"})
                return self._resp(302, b"", {"Location": f"{destino}#{frag}"})
            uid, tipo = uid_tipo; USUARIOS[uid]["confirmado"] = True
            return self._resp(302, b"", {"Location": f"{destino}#{urllib.parse.urlencode({**sesion_de(uid), 'type': tipo})}"})
        if u.path == "/auth/v1/authorize":
            destino = q["redirect_to"][0]
            s = sesion_de(usuario_por_email(SIGUIENTE["email"]))
            frag = urllib.parse.urlencode({**s, "provider_token": "x"})
            return self._resp(302, b"", {"Location": f"{destino}#{frag}"})
        if u.path == "/__test/estado":
            return self._resp(200, {"usuarios": USUARIOS, "pases": PASES, "seguimiento": SEGUIMIENTO, "correos": CORREOS, "cuentas": CUENTAS, "log": LOG})
        if len(partes) != 3 or partes[:2] != ["rest", "v1"]: return self._resp(404)
        t = partes[2]
        if self.headers.get("apikey") not in (KEY_ANON, KEY_SERVICE): return self._resp(401)
        if not self._perfil_ok(): return self._resp(404, {"code": "PGRST205", "message": f"tabla {t} no esta en el esquema public"})
        uid = self._usuario()
        if t == "pases":
            if not uid: return self._resp(200, [])
            return self._resp(200, aplicar([p for p in PASES if p["user_id"] == uid], q))
        if t == "seguimiento":
            if not uid or not tiene_pase(uid): return self._resp(200, [])      # RLS: sin pase no se ve nada
            return self._resp(200, aplicar([SEGUIMIENTO[uid]] if uid in SEGUIMIENTO else [], q))
        if t == "keepalive" and self.headers.get("apikey") == KEY_ANON: return self._resp(200, [])  # RLS sin politicas
        self._resp(200, aplicar(list(TABLAS.get(t, {}).values()), q))

    def do_POST(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query); partes = u.path.strip("/").split("/")
        LOG.append(("POST", u.path))
        if u.path == "/__test/siguiente": SIGUIENTE["email"] = self._cuerpo()["email"]; return self._resp(204)
        if u.path == "/__test/usuario":
            d = self._cuerpo(); usuario_por_email(d["email"], cuenta=d.get("cuenta", "vieja"), password=d.get("password", CLAVE_POR_DEFECTO), confirmado=d.get("confirmado", True))
            return self._resp(204)
        if u.path == "/__test/invitado":
            d = self._cuerpo(); a, b = buscar(d["email"]), buscar(d["de"]); CUENTAS[a]["referido_por"] = b
            return self._resp(204)
        if u.path == "/__test/mover_alta":
            d = self._cuerpo(); CUENTAS[buscar(d["email"])]["alta"] = dias(-d["dias"])
            return self._resp(204)
        if u.path == "/__test/pase":
            d = self._cuerpo(); uid = usuario_por_email(d["email"])
            anadir_pase({"id": len(PASES) + 1, "user_id": uid, "curso": d.get("curso", curso_de()), "producto": d.get("producto", "pase_2025_26"), "tipo": d.get("tipo", "suscripcion"),
                         "token": "tok-" + secrets.token_hex(6), "expira": d["expira"], "estado": "activo"})
            return self._resp(204)
        if u.path == "/auth/v1/token":
            d = self._cuerpo() or {}
            if q.get("grant_type", [""])[0] == "password":
                if d.get("email", "").startswith("limite@"):
                    return self._resp(429, {"code": 429, "error_code": "over_request_rate_limit", "msg": "Request rate limit reached"})
                uid = buscar(d.get("email", ""))
                if not uid or USUARIOS[uid]["password"] != d.get("password"):
                    return self._resp(400, {"code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials"})
                if not USUARIOS[uid]["confirmado"]:
                    return self._resp(400, {"code": 400, "error_code": "email_not_confirmed", "msg": "Email not confirmed"})
                return self._resp(200, sesion_de(uid))
            uid = REFRESCO.get(d.get("refresh_token"))
            return self._resp(200, sesion_de(uid)) if uid else self._resp(400, {"error": "invalid_grant"})
        if u.path == "/auth/v1/signup":
            d = self._cuerpo() or {}; destino = q.get("redirect_to", [""])[0]; email = d.get("email", "")
            if len(d.get("password", "")) < 8: return self._resp(422, {"code": 422, "error_code": "weak_password", "msg": "Password should be at least 8 characters."})
            if buscar(email):      # Supabase no revela que el correo ya existe: respuesta "normal" sin identidades y sin correo
                return self._resp(200, {"id": "x", "email": email, "identities": []})
            uid = usuario_por_email(email, cuenta="nueva", password=d["password"], confirmado=False, meta=d.get("data") or {})
            CORREOS.append({"para": email, "tipo": "confirmar", "enlace": enlace_correo(f"http://{self.headers['Host']}", destino, uid, "signup")})
            return self._resp(200, {"id": uid, "email": email, "identities": [{"provider": "email"}]})
        if u.path == "/auth/v1/recover":
            d = self._cuerpo() or {}; destino = q.get("redirect_to", [""])[0]; uid = buscar(d.get("email", ""))
            if uid: CORREOS.append({"para": d["email"], "tipo": "recuperar", "enlace": enlace_correo(f"http://{self.headers['Host']}", destino, uid, "recovery")})
            return self._resp(200, {})
        if u.path == "/auth/v1/logout": return self._resp(204)
        if u.path == "/functions/v1/aragon-verificar-compra": return self._verificar()
        if len(partes) < 3 or partes[:2] != ["rest", "v1"]: return self._resp(404)
        if not self._perfil_ok(): return self._resp(404, {"code": "PGRST205"})
        if partes[2] == "rpc" and partes[3:] == ["borrar_mis_datos"]:
            uid = self._usuario()
            if not uid: return self._resp(401)
            SEGUIMIENTO.pop(uid, None)      # el usuario (compartido con otras webs) se queda
            PASES[:] = [p for p in PASES if p["user_id"] != uid]
            CUENTAS.pop(uid, None)
            for c in CUENTAS.values():
                if c["referido_por"] == uid: c["referido_por"] = None
            return self._resp(200, b"")
        if partes[2] == "rpc" and partes[3:] in (["mi_acceso"], ["usar_codigo"], ["mi_referidos"]):
            uid = self._usuario()
            if not uid: return self._resp(401, {"message": "No has iniciado sesion"})
            d = self._cuerpo() or {}; fn = partes[3]
            if fn == "usar_codigo":
                asegurar_cuenta(uid); return self._resp(200, aplicar_codigo(uid, d.get("p_codigo")))
            if fn == "mi_acceso":
                nueva = asegurar_cuenta(uid); res = None
                cod = (USUARIOS[uid]["meta"].get("codigo_invitacion_aragon") or "").strip()
                if nueva and cod: res = aplicar_codigo(uid, cod)
                return self._resp(200, {"nueva": nueva, "codigo_invitacion": res})
            asegurar_cuenta(uid); c = CUENTAS[uid]; curso = curso_de()
            return self._resp(200, {"codigo": c["codigo"], "necesarios": 3, "invitados": sum(1 for x in CUENTAS.values() if x["referido_por"] == uid),
                                    "pagados": pagados(uid, curso), "gratis": any(p["user_id"] == uid and p["tipo"] == "invitaciones" and p["curso"] == curso for p in PASES),
                                    "usado": c["referido_por"] is not None,
                                    "puede_usar": c["referido_por"] is None and (dt.date.today() - dt.date.fromisoformat(c["alta"])).days <= 30})
        t = partes[2]
        if t == "seguimiento":
            uid = self._usuario(); d = self._cuerpo()
            if not uid or not tiene_pase(uid) or d.get("user_id") != uid: return self._resp(403, {"code": "42501", "message": "RLS"})
            if len(json.dumps(d["datos"])) > 100000: return self._resp(400, {"code": "23514"})
            SEGUIMIENTO[uid] = d; return self._resp(201)
        # carga de los robots (clave service_role)
        if self.headers.get("apikey") != KEY_SERVICE: return self._resp(401, b'{"message":"clave service_role necesaria"}')
        filas = self._cuerpo()
        claves = q.get("on_conflict", ["id"])[0].split(",")
        # PostgREST exige que todas las filas del lote tengan las mismas claves
        if len({tuple(sorted(f)) for f in filas}) > 1: return self._resp(400, b'{"message":"All object keys must match"}')
        tab = TABLAS.setdefault(t, {})
        ignorar = "ignore-duplicates" in self.headers.get("Prefer", "")
        for f in filas:
            k = tuple(f.get(c) for c in claves)
            if not (ignorar and k in tab): tab[k] = f
        self._resp(201)

    def do_PUT(self):
        u = urllib.parse.urlparse(self.path)
        LOG.append(("PUT", u.path))
        if u.path != "/auth/v1/user": return self._resp(404)
        uid = self._usuario()
        if not uid: return self._resp(401, {"code": 401, "msg": "Invalid token"})
        d = self._cuerpo() or {}
        if len(d.get("password", "")) < 8: return self._resp(422, {"code": 422, "error_code": "weak_password", "msg": "Password should be at least 8 characters."})
        if d["password"] == USUARIOS[uid]["password"]: return self._resp(422, {"code": 422, "error_code": "same_password", "msg": "New password should be different from the old password."})
        USUARIOS[uid]["password"] = d["password"]
        self._resp(200, {"id": uid, "email": USUARIOS[uid]["email"]})

    def _verificar(self):
        uid = self._usuario()
        if not uid: return self._resp(401, {"ok": False, "codigo": "sin_sesion", "mensaje": "Inicia sesión para activar tu pase."})
        d = self._cuerpo() or {}
        m = re.fullmatch(r"pase_(\d{4})_(\d{2})", str(d.get("producto", "")))
        tok = str(d.get("token", ""))
        if not m or len(tok) < 10: return self._resp(400, {"ok": False, "codigo": "producto_invalido", "mensaje": "Producto no válido."})
        previa = next((p for p in PASES if p["token"] == tok), None)
        if previa:
            if previa["user_id"] != uid: return self._resp(409, {"ok": False, "codigo": "compra_de_otro", "mensaje": "Esta compra ya está asociada a otra cuenta."})
            return self._resp(200, {"ok": True, "curso": previa["curso"], "expira": previa["expira"], "repetida": True})
        if tok.startswith("tok-pend"): return self._resp(402, {"ok": False, "codigo": "pago_pendiente", "mensaje": "El pago aún está pendiente."})
        if not tok.startswith("tok-test"): return self._resp(400, {"ok": False, "codigo": "compra_desconocida", "mensaje": "Google no reconoce esta compra."})
        fin = f"{int(m[1]) + 1}-06-30"
        anadir_pase({"id": len(PASES) + 1, "user_id": uid, "curso": f"{m[1]}-{m[2]}", "producto": d["producto"], "tipo": "pago_unico", "token": tok, "expira": fin, "estado": "activo"})
        self._resp(200, {"ok": True, "curso": f"{m[1]}-{m[2]}", "expira": fin})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 54321), H).serve_forever()
