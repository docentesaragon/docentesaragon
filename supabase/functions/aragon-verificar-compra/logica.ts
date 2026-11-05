// Lógica de "aragon-verificar-compra": comprueba una compra de Google Play y crea el pase hasta el 30/06 del curso.
// Sin dependencias externas y sin APIs exclusivas de Deno, para poder probarla también con Node (prueba.test.ts).

export type Entorno = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  paquete: string;                 // p. ej. es.docentes.aragon (nombre del paquete de la app en Google Play)
  tipo: "suscripcion" | "pago_unico";
  cuentaServicio: { client_email: string; private_key: string; token_uri?: string };
  esquema?: string;                // esquema de Postgres; por defecto "aragon"
  googleApi?: string;              // solo para pruebas
  hoy?: () => Date;                // solo para pruebas
};

export type Resultado = { estado: number; cuerpo: Record<string, unknown> };

const GOOGLE_API = "https://androidpublisher.googleapis.com";
const ALCANCE = "https://www.googleapis.com/auth/androidpublisher";

/** pase_2026_27 -> curso 2026-27, válido hasta el 30/06/2027. */
export function cursoDeProducto(producto: string): { curso: string; expira: string } | null {
  const m = /^pase_(\d{4})_(\d{2})$/.exec(producto);
  if (!m) return null;
  const inicio = Number(m[1]);
  if (Number(m[2]) !== (inicio + 1) % 100) return null;   // 2026_27 sí, 2026_29 no
  return { curso: `${m[1]}-${m[2]}`, expira: `${inicio + 1}-06-30` };
}

const b64url = (datos: Uint8Array | string): string => {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : datos;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemADer(pem: string): Uint8Array {
  const base = pem.replace(/-----BEGIN [A-Z ]+-----/, "").replace(/-----END [A-Z ]+-----/, "").replace(/\s+/g, "");
  const bin = atob(base);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** JWT firmado con la clave de la cuenta de servicio (RS256), para pedir un token de acceso a Google. */
export async function firmarJwt(cuenta: Entorno["cuentaServicio"], ahoraSeg: number): Promise<string> {
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = b64url(JSON.stringify({
    iss: cuenta.client_email, scope: ALCANCE, aud: cuenta.token_uri || "https://oauth2.googleapis.com/token",
    iat: ahoraSeg, exp: ahoraSeg + 3600,
  }));
  const clave = await crypto.subtle.importKey("pkcs8", pemADer(cuenta.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", clave, new TextEncoder().encode(`${cabecera}.${cuerpo}`)));
  return `${cabecera}.${cuerpo}.${b64url(firma)}`;
}

async function tokenDeGoogle(e: Entorno): Promise<string> {
  const jwt = await firmarJwt(e.cuentaServicio, Math.floor((e.hoy ? e.hoy() : new Date()).getTime() / 1000));
  const r = await fetch(e.cuentaServicio.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!r.ok) throw new Error(`Google no dio el token de acceso (${r.status})`);
  return (await r.json()).access_token as string;
}

const rechazo = (estado: number, mensaje: string, codigo: string): Resultado => ({ estado, cuerpo: { ok: false, codigo, mensaje } });

async function googleGet(e: Entorno, acceso: string, ruta: string) {
  const r = await fetch(`${e.googleApi || GOOGLE_API}/androidpublisher/v3/applications/${encodeURIComponent(e.paquete)}/${ruta}`, { headers: { Authorization: `Bearer ${acceso}` } });
  return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null };
}
async function googlePost(e: Entorno, acceso: string, ruta: string) {
  return fetch(`${e.googleApi || GOOGLE_API}/androidpublisher/v3/applications/${encodeURIComponent(e.paquete)}/${ruta}`, {
    method: "POST", headers: { Authorization: `Bearer ${acceso}`, "Content-Type": "application/json" }, body: "{}",
  });
}

const sb = (e: Entorno, extra: Record<string, string> = {}) => ({
  apikey: e.supabaseServiceKey, Authorization: `Bearer ${e.supabaseServiceKey}`, "Content-Type": "application/json",
  "Accept-Profile": e.esquema || "aragon", "Content-Profile": e.esquema || "aragon", ...extra,
});

const aFecha = (d: Date) => d.toISOString().slice(0, 10);

/** Comprueba la compra con Google y devuelve hasta qué fecha vale (null + resultado de rechazo si no vale). */
async function validarConGoogle(e: Entorno, producto: string, token: string, finCurso: string, hoy: string): Promise<{ expira: string } | Resultado> {
  const acceso = await tokenDeGoogle(e);
  const t = encodeURIComponent(token);
  if (e.tipo === "suscripcion") {
    const r = await googleGet(e, acceso, `purchases/subscriptionsv2/tokens/${t}`);
    if (!r.ok) return rechazo(400, "Google no reconoce esta compra.", "compra_desconocida");
    const s = r.json;
    const linea = (s.lineItems || []).find((l: { productId: string }) => l.productId === producto);
    if (!linea) return rechazo(400, "La compra no corresponde a este producto.", "producto_distinto");
    const estadoOk = ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"].includes(s.subscriptionState);
    const finGoogle = linea.expiryTime ? aFecha(new Date(linea.expiryTime)) : "";
    if (s.subscriptionState === "SUBSCRIPTION_STATE_PENDING") return rechazo(402, "El pago aún está pendiente.", "pago_pendiente");
    if (!estadoOk || !finGoogle || finGoogle < hoy) return rechazo(402, "La suscripción no está en vigor.", "no_vigente");
    if (s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
      const a = await googlePost(e, acceso, `purchases/subscriptions/${encodeURIComponent(producto)}/tokens/${t}:acknowledge`);
      if (!a.ok) return rechazo(502, "No se pudo confirmar la compra con Google. Inténtalo de nuevo.", "ack_fallido");
    }
    return { expira: finGoogle < finCurso ? finGoogle : finCurso };    // nunca más allá del 30/06
  }
  const r = await googleGet(e, acceso, `purchases/products/${encodeURIComponent(producto)}/tokens/${t}`);
  if (!r.ok) return rechazo(400, "Google no reconoce esta compra.", "compra_desconocida");
  if (r.json.purchaseState === 2) return rechazo(402, "El pago aún está pendiente.", "pago_pendiente");
  if (r.json.purchaseState !== 0) return rechazo(402, "La compra está cancelada.", "no_vigente");
  if (r.json.acknowledgementState === 0) {
    const a = await googlePost(e, acceso, `purchases/products/${encodeURIComponent(producto)}/tokens/${t}:acknowledge`);
    if (!a.ok) return rechazo(502, "No se pudo confirmar la compra con Google. Inténtalo de nuevo.", "ack_fallido");
  }
  return { expira: finCurso };
}

/** Punto de entrada: usuario ya identificado (id) + datos que envía la web. */
export async function procesarCompra(e: Entorno, usuarioId: string, entrada: { producto?: unknown; token?: unknown }): Promise<Resultado> {
  const producto = typeof entrada.producto === "string" ? entrada.producto : "";
  const token = typeof entrada.token === "string" ? entrada.token : "";
  const info = cursoDeProducto(producto);
  if (!info) return rechazo(400, "Producto no válido.", "producto_invalido");
  if (token.length < 10 || token.length > 4096) return rechazo(400, "Falta el código de compra.", "token_invalido");
  const hoy = aFecha(e.hoy ? e.hoy() : new Date());
  if (info.expira < hoy) return rechazo(400, "Ese pase ya ha caducado.", "curso_pasado");

  // ¿Ya está registrada esta compra?
  const url = `${e.supabaseUrl}/rest/v1/pases`;
  const previa = await fetch(`${url}?select=user_id,curso,expira&token=eq.${encodeURIComponent(token)}`, { headers: sb(e) });
  if (!previa.ok) return rechazo(502, "No se pudo consultar la base de datos.", "bd");
  const ya = (await previa.json())[0];
  if (ya) {
    if (ya.user_id !== usuarioId) return rechazo(409, "Esta compra ya está asociada a otra cuenta.", "compra_de_otro");
    return { estado: 200, cuerpo: { ok: true, curso: ya.curso, expira: ya.expira, repetida: true } };
  }

  const v = await validarConGoogle(e, producto, token, info.expira, hoy);
  if ("estado" in v) return v;

  const crear = await fetch(url, {
    method: "POST", headers: sb(e, { Prefer: "return=minimal" }),
    body: JSON.stringify({ user_id: usuarioId, curso: info.curso, producto, tipo: e.tipo, token, expira: v.expira, estado: "activo" }),
  });
  if (crear.status === 409) return rechazo(409, "Esta compra ya está asociada a otra cuenta.", "compra_de_otro");
  if (!crear.ok) return rechazo(502, "La compra es válida, pero no se pudo guardar el pase. Vuelve a intentarlo.", "bd");
  return { estado: 200, cuerpo: { ok: true, curso: info.curso, expira: v.expira } };
}
