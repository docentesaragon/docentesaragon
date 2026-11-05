// Pruebas de logica.ts con Google y Supabase simulados.   node --test prueba.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { cursoDeProducto, procesarCompra, firmarJwt, type Entorno } from "./logica.ts";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const USUARIO = "11111111-1111-1111-1111-111111111111", OTRO = "22222222-2222-2222-2222-222222222222";
const TOKEN = "token-de-compra-de-prueba-0001";

let srv: http.Server, base = "";
let google: { jwtValido: boolean; claims: Record<string, unknown> | null; llamadas: string[]; respuestas: Record<string, { status: number; cuerpo?: unknown }>; };
let pases: Record<string, unknown>[];

before(async () => {
  srv = http.createServer(async (req, res) => {
    const trozos: Buffer[] = []; for await (const t of req) trozos.push(t as Buffer);
    const cuerpo = Buffer.concat(trozos).toString();
    const url = new URL(req.url!, base);
    const json = (st: number, o: unknown) => { res.writeHead(st, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (url.pathname === "/oauth/token") {                       // Google: token de acceso
      const jwt = new URLSearchParams(cuerpo).get("assertion")!; const [c, p, f] = jwt.split(".");
      google.jwtValido = crypto.verify("RSA-SHA256", Buffer.from(`${c}.${p}`), publicKey, Buffer.from(f, "base64url"));
      google.claims = JSON.parse(Buffer.from(p, "base64url").toString());
      return json(200, { access_token: "acceso-falso" });
    }
    if (url.pathname.startsWith("/androidpublisher/")) {         // Google: compras
      assert.equal(req.headers.authorization, "Bearer acceso-falso");
      const clave = `${req.method} ${url.pathname.replace(/\/tokens\/[^/:]+/, "/tokens/T").replace(/.*applications\/[^/]+\//, "")}`;
      google.llamadas.push(clave);
      const r = google.respuestas[clave];
      if (!r) return json(404, { error: "no configurado: " + clave });
      return json(r.status, r.cuerpo ?? {});
    }
    if (url.pathname === "/rest/v1/pases") {                     // Supabase REST
      assert.equal(req.headers["content-profile"], "aragon"); assert.equal(req.headers["accept-profile"], "aragon");
      assert.equal(req.headers.apikey, "service-key");
      if (req.method === "GET") { const t = url.searchParams.get("token")!.replace("eq.", ""); return json(200, pases.filter((p) => p.token === t)); }
      if (req.method === "POST") {
        const fila = JSON.parse(cuerpo);
        if (pases.some((p) => p.token === fila.token)) return json(409, { code: "23505" });
        pases.push(fila); res.writeHead(201); return res.end();
      }
    }
    json(404, {});
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
after(() => srv.close());
beforeEach(() => { pases = []; google = { jwtValido: false, claims: null, llamadas: [], respuestas: {} }; });

const entorno = (extra: Partial<Entorno> = {}): Entorno => ({
  supabaseUrl: base, supabaseServiceKey: "service-key", paquete: "es.prueba.app", tipo: "suscripcion",
  cuentaServicio: { client_email: "robot@proyecto.iam.gserviceaccount.com", private_key: privateKey, token_uri: `${base}/oauth/token` },
  googleApi: base, hoy: () => new Date("2026-11-05T12:00:00Z"), ...extra,
});
const SUBS = "GET purchases/subscriptionsv2/tokens/T";
const SUBS_ACK = "POST purchases/subscriptions/pase_2026_27/tokens/T:acknowledge";
const PROD = "GET purchases/products/pase_2026_27/tokens/T";
const PROD_ACK = "POST purchases/products/pase_2026_27/tokens/T:acknowledge";
const suscripcion = (o: Record<string, unknown> = {}) => ({ status: 200, cuerpo: { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
  lineItems: [{ productId: "pase_2026_27", expiryTime: "2027-11-05T10:00:00Z" }], ...o } });

test("cursoDeProducto", () => {
  assert.deepEqual(cursoDeProducto("pase_2026_27"), { curso: "2026-27", expira: "2027-06-30" });
  assert.deepEqual(cursoDeProducto("pase_2029_30"), { curso: "2029-30", expira: "2030-06-30" });
  assert.equal(cursoDeProducto("pase_2026_29"), null);
  assert.equal(cursoDeProducto("otra_cosa"), null);
  assert.equal(cursoDeProducto("pase_2026_27; drop"), null);
});

test("firma del JWT: RS256 válida y con los datos que pide Google", async () => {
  const jwt = await firmarJwt({ client_email: "robot@x", private_key: privateKey }, 1000);
  const [c, p, f] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(c, "base64url").toString()).alg, "RS256");
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${c}.${p}`), publicKey, Buffer.from(f, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.iss, "robot@x"); assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token"); assert.equal(claims.exp - claims.iat, 3600);
});

test("suscripción prepago de 1 año comprada en noviembre: pase hasta el 30/06, confirma la compra y la guarda", async () => {
  google.respuestas[SUBS] = suscripcion(); google.respuestas[SUBS_ACK] = { status: 200 };
  const r = await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN });
  assert.equal(r.estado, 200); assert.deepEqual([r.cuerpo.curso, r.cuerpo.expira], ["2026-27", "2027-06-30"]);
  assert.ok(google.jwtValido); assert.equal(google.claims!.iss, "robot@proyecto.iam.gserviceaccount.com");
  assert.deepEqual(google.llamadas, [SUBS, SUBS_ACK]);
  assert.deepEqual(pases, [{ user_id: USUARIO, curso: "2026-27", producto: "pase_2026_27", tipo: "suscripcion", token: TOKEN, expira: "2027-06-30", estado: "activo" }]);
});

test("si Google dice que acaba antes del 30/06, manda Google", async () => {
  google.respuestas[SUBS] = suscripcion({ lineItems: [{ productId: "pase_2026_27", expiryTime: "2026-12-05T10:00:00Z" }] }); google.respuestas[SUBS_ACK] = { status: 200 };
  const r = await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN });
  assert.equal(r.cuerpo.expira, "2026-12-05");
});

test("compra ya confirmada: no vuelve a confirmar", async () => {
  google.respuestas[SUBS] = suscripcion({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" });
  const r = await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN });
  assert.equal(r.estado, 200); assert.deepEqual(google.llamadas, [SUBS]);
});

test("suscripción cancelada pero aún en vigor vale; pendiente, caducada o en pausa no", async () => {
  google.respuestas[SUBS_ACK] = { status: 200 };
  google.respuestas[SUBS] = suscripcion({ subscriptionState: "SUBSCRIPTION_STATE_CANCELED" });
  assert.equal((await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN })).estado, 200);
  for (const [estado, codigo] of [["SUBSCRIPTION_STATE_PENDING", "pago_pendiente"], ["SUBSCRIPTION_STATE_EXPIRED", "no_vigente"], ["SUBSCRIPTION_STATE_ON_HOLD", "no_vigente"]]) {
    pases = []; google.respuestas[SUBS] = suscripcion({ subscriptionState: estado });
    const r = await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN + estado });
    assert.equal(r.cuerpo.codigo, codigo, estado); assert.equal(pases.length, 0);
  }
});

test("producto distinto al comprado, o compra que Google no conoce: rechazo", async () => {
  google.respuestas[SUBS] = suscripcion({ lineItems: [{ productId: "otro_producto", expiryTime: "2027-11-05T10:00:00Z" }] });
  assert.equal((await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN })).cuerpo.codigo, "producto_distinto");
  google.respuestas[SUBS] = { status: 404 };
  assert.equal((await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN })).cuerpo.codigo, "compra_desconocida");
  assert.equal(pases.length, 0);
});

test("si no se puede confirmar con Google, no se crea el pase", async () => {
  google.respuestas[SUBS] = suscripcion(); google.respuestas[SUBS_ACK] = { status: 500 };
  const r = await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN });
  assert.equal(r.estado, 502); assert.equal(pases.length, 0);
});

test("la misma compra no sirve para dos cuentas; la misma cuenta puede repetir sin llamar a Google", async () => {
  google.respuestas[SUBS] = suscripcion(); google.respuestas[SUBS_ACK] = { status: 200 };
  await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN });
  const n = google.llamadas.length;
  const otro = await procesarCompra(entorno(), OTRO, { producto: "pase_2026_27", token: TOKEN });
  assert.equal(otro.estado, 409); assert.equal(otro.cuerpo.codigo, "compra_de_otro");
  const igual = await procesarCompra(entorno(), USUARIO, { producto: "pase_2026_27", token: TOKEN });
  assert.equal(igual.estado, 200); assert.equal(igual.cuerpo.repetida, true);
  assert.equal(google.llamadas.length, n); assert.equal(pases.length, 1);
});

test("pago único: válido hasta el 30/06, confirma; pendiente y cancelada se rechazan", async () => {
  google.respuestas[PROD] = { status: 200, cuerpo: { purchaseState: 0, acknowledgementState: 0 } }; google.respuestas[PROD_ACK] = { status: 200 };
  const r = await procesarCompra(entorno({ tipo: "pago_unico" }), USUARIO, { producto: "pase_2026_27", token: TOKEN });
  assert.equal(r.estado, 200); assert.equal(r.cuerpo.expira, "2027-06-30"); assert.deepEqual(google.llamadas, [PROD, PROD_ACK]); assert.equal(pases[0].tipo, "pago_unico");
  for (const [estado, codigo] of [[2, "pago_pendiente"], [1, "no_vigente"]] as const) {
    pases = []; google.respuestas[PROD] = { status: 200, cuerpo: { purchaseState: estado, acknowledgementState: 0 } };
    assert.equal((await procesarCompra(entorno({ tipo: "pago_unico" }), USUARIO, { producto: "pase_2026_27", token: TOKEN + estado })).cuerpo.codigo, codigo);
  }
});

test("entradas inválidas y cursos pasados no llegan a Google", async () => {
  for (const entrada of [{ producto: "x", token: TOKEN }, { producto: "pase_2026_27", token: "corto" }, { producto: 5, token: TOKEN }, {}]) {
    assert.equal((await procesarCompra(entorno(), USUARIO, entrada)).estado, 400);
  }
  const pasado = await procesarCompra(entorno(), USUARIO, { producto: "pase_2025_26", token: TOKEN });
  assert.equal(pasado.cuerpo.codigo, "curso_pasado"); assert.equal(google.llamadas.length, 0);
});

test("el último día (30/06) todavía se puede activar; el 1/07 ya no", async () => {
  const g = (h: string) => entorno({ hoy: () => new Date(h) });
  google.respuestas[SUBS] = suscripcion({ lineItems: [{ productId: "pase_2025_26", expiryTime: "2027-06-30T10:00:00Z" }] });
  google.respuestas["POST purchases/subscriptions/pase_2025_26/tokens/T:acknowledge"] = { status: 200 };
  assert.equal((await procesarCompra(g("2026-06-30T10:00:00Z"), USUARIO, { producto: "pase_2025_26", token: TOKEN })).estado, 200);
  assert.equal((await procesarCompra(g("2026-07-01T10:00:00Z"), USUARIO, { producto: "pase_2025_26", token: TOKEN + "2" })).cuerpo.codigo, "curso_pasado");
});
