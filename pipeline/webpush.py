#!/usr/bin/env python3
"""Avisos «push» al móvil/navegador SIN dependencias raras: solo la librería `cryptography` (pip install cryptography).

Implementa lo mínimo del estándar Web Push:
  · RFC 8291  cifrado del mensaje (aes128gcm) con las claves que el dispositivo entregó al aceptar los avisos;
  · RFC 8292  identificación del servidor (VAPID, firma ES256);
  · RFC 8188  formato del cuerpo.
No guarda nada ni habla con nadie salvo con el servicio de avisos del propio dispositivo (Google/Firefox/Apple/Microsoft).
"""
import base64
import json
import os
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF, HKDFExpand

# Solo se envía a los servicios de avisos conocidos (protege al robot si alguien registrase una dirección interna).
SERVICIOS = ("fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", ".push.services.mozilla.com",
             "web.push.apple.com", ".push.apple.com", ".notify.windows.com")


def b64u(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode("ascii")


def de_b64u(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def punto_publico(clave: ec.EllipticCurvePrivateKey) -> bytes:
    return clave.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def generar_vapid():
    """Par de claves VAPID: (publica, privada) en base64url. La pública va al navegador; la privada solo al robot."""
    c = ec.generate_private_key(ec.SECP256R1())
    return b64u(punto_publico(c)), b64u(c.private_numbers().private_value.to_bytes(32, "big"))


def clave_privada(b64: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(de_b64u(b64), "big"), ec.SECP256R1())


def servicio_permitido(endpoint: str) -> bool:
    u = urllib.parse.urlparse(endpoint)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or u.port not in (None, 443) or u.username or u.password:
        return False
    return any(host == s.lstrip(".") or (s.startswith(".") and host.endswith(s)) for s in SERVICIOS)


def cifrar(mensaje: bytes, p256dh: str, auth: str, _privada_efimera=None, _sal=None) -> bytes:
    """Cuerpo cifrado (RFC 8291 + 8188) para un dispositivo. p256dh y auth: las claves que dio, en base64url.
    _privada_efimera y _sal solo se usan en las pruebas con el ejemplo del estándar."""
    ua_publica, secreto_auth = de_b64u(p256dh), de_b64u(auth)
    if len(ua_publica) != 65 or ua_publica[0] != 4 or len(secreto_auth) != 16:
        raise ValueError("claves del dispositivo no válidas")
    efimera = _privada_efimera or ec.generate_private_key(ec.SECP256R1())
    as_publica = punto_publico(efimera)
    compartido = efimera.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_publica))
    ikm = HKDF(hashes.SHA256(), 32, secreto_auth, b"WebPush: info\x00" + ua_publica + as_publica).derive(compartido)
    sal = _sal or os.urandom(16)
    clave_cifrado = HKDF(hashes.SHA256(), 16, sal, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, sal, b"Content-Encoding: nonce\x00").derive(ikm)
    if len(mensaje) > 3900:
        raise ValueError("mensaje demasiado largo")
    cifrado = AESGCM(clave_cifrado).encrypt(nonce, mensaje + b"\x02", None)      # \x02 = último (y único) bloque
    return sal + struct.pack(">IB", 4096, len(as_publica)) + as_publica + cifrado


def descifrar(cuerpo: bytes, privada_dispositivo: ec.EllipticCurvePrivateKey, auth: str) -> bytes:
    """Lo que haría el móvil: solo para las pruebas."""
    sal, (_tam, largo_id) = cuerpo[:16], struct.unpack(">IB", cuerpo[16:21])
    as_publica, cifrado = cuerpo[21:21 + largo_id], cuerpo[21 + largo_id:]
    ua_publica = punto_publico(privada_dispositivo)
    compartido = privada_dispositivo.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_publica))
    ikm = HKDF(hashes.SHA256(), 32, de_b64u(auth), b"WebPush: info\x00" + ua_publica + as_publica).derive(compartido)
    clave = HKDF(hashes.SHA256(), 16, sal, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, sal, b"Content-Encoding: nonce\x00").derive(ikm)
    return AESGCM(clave).decrypt(nonce, cifrado, None).rstrip(b"\x00")[:-1]      # quita el relleno y la marca de último bloque (\x02)


def firma_vapid(endpoint: str, privada_b64: str, publica_b64: str, contacto: str, ahora=None) -> str:
    """Cabecera «Authorization» de VAPID (RFC 8292): firma ES256 válida 12 horas para el servicio de ese dispositivo."""
    u = urllib.parse.urlparse(endpoint)
    cab = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    cuerpo = b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(ahora or time.time()) + 12 * 3600, "sub": contacto}, separators=(",", ":")).encode())
    r, s = decode_dss_signature(clave_privada(privada_b64).sign(f"{cab}.{cuerpo}".encode(), ec.ECDSA(hashes.SHA256())))
    return f"vapid t={cab}.{cuerpo}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}, k={publica_b64}"


def enviar(dispositivo: dict, mensaje: dict, vapid_publica: str, vapid_privada: str, contacto: str, ttl: int = 86400, timeout: int = 20) -> str:
    """Envía un aviso a un dispositivo {endpoint, p256dh, auth}. Devuelve:
       «ok»        el servicio lo ha aceptado;
       «muerto»    el dispositivo ya no existe (404/410): hay que olvidarlo;
       «invalido»  dirección no permitida o claves rotas: hay que olvidarlo;
       «reintentar» fallo pasajero (red, 429, 5xx): se intentará en la próxima ejecución;
       «error»     otro rechazo."""
    endpoint = dispositivo["endpoint"]
    if not servicio_permitido(endpoint):
        return "invalido"
    try:
        cuerpo = cifrar(json.dumps(mensaje, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), dispositivo["p256dh"], dispositivo["auth"])
    except (ValueError, KeyError):
        return "invalido"
    cab = {"Authorization": firma_vapid(endpoint, vapid_privada, vapid_publica, contacto), "Content-Encoding": "aes128gcm",
           "Content-Type": "application/octet-stream", "TTL": str(ttl), "Urgency": "normal"}
    try:
        with urllib.request.urlopen(urllib.request.Request(endpoint, data=cuerpo, headers=cab, method="POST"), timeout=timeout) as r:
            return "ok" if r.status in (200, 201, 202) else "error"
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return "muerto"
        if e.code == 429 or e.code >= 500:
            return "reintentar"
        return "error"
    except (urllib.error.URLError, TimeoutError, OSError):
        return "reintentar"
