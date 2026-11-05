// Compra del pase con Google Play Billing, desde la app de Android (la web empaquetada como Trusted Web Activity).
// Usa la Digital Goods API + Payment Request. La compra se comprueba en el servidor (función "aragon-verificar-compra").
import { CUENTA, tokenActual, pagoHecho, URL_FUNCIONES, CLAVE_ANON } from "./cuenta.js";

const cfg = window.CONFIG || {};
const PLAY = "https://play.google.com/billing";

/** Producto del curso en venta: del 1 de julio al 30 de junio siguiente. 2026-11 -> pase_2026_27; 2027-07 -> pase_2027_28. */
export function productoActual(hoy = new Date()) {
  if (cfg.productoPlay) return cfg.productoPlay;
  const a = hoy.getFullYear();
  const inicio = hoy.getMonth() >= 6 ? a : a - 1;
  return `pase_${inicio}_${String((inicio + 1) % 100).padStart(2, "0")}`;
}
export const cursoDeProducto = (p) => { const m = /^pase_(\d{4})_(\d{2})$/.exec(p); return m ? { curso: `${m[1]}/${m[2]}`, hasta: `30/06/${+m[1] + 1}` } : null; };

export const compraDisponible = () => typeof window.getDigitalGoodsService === "function" && typeof window.PaymentRequest === "function";

export async function precioEnPlay(sku) {
  try {
    const servicio = await window.getDigitalGoodsService(PLAY);
    const [d] = await servicio.getDetails([sku]);
    return d?.price ? new Intl.NumberFormat("es-ES", { style: "currency", currency: d.price.currency }).format(+d.price.value) : null;
  } catch (e) { return null; }
}

async function verificarEnServidor(producto, token) {
  const r = await fetch(`${URL_FUNCIONES}/aragon-verificar-compra`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CLAVE_ANON, Authorization: "Bearer " + tokenActual() },
    body: JSON.stringify({ producto, token }),
  });
  let j = {};
  try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { ok: r.ok && j.ok === true, mensaje: j.mensaje || (r.ok ? "" : `Error ${r.status}`), ...j };
}

/** Abre la hoja de pago de Google Play. Devuelve { ok } o { cancelado } o { ok:false, mensaje }. */
export async function comprarPase() {
  const sku = productoActual();
  const peticion = new PaymentRequest(
    [{ supportedMethods: PLAY, data: { sku } }],
    { total: { label: "Pase", amount: { currency: "EUR", value: "0" } } });   // el precio real lo pone Play Console
  let respuesta;
  try { respuesta = await peticion.show(); }
  catch (e) { if (e?.name === "AbortError" || /cancel/i.test(e?.message || "")) return { cancelado: true }; throw e; }
  try {
    const token = respuesta.details?.purchaseToken;
    const r = await verificarEnServidor(sku, token);
    await respuesta.complete(r.ok ? "success" : "fail");
    if (r.ok) await pagoHecho();
    else if (!r.mensaje) r.mensaje = "No se pudo activar el pase.";
    return r.ok ? { ok: true } : { ok: false, mensaje: `${r.mensaje} Si ya has pagado, pulsa «Restaurar compra».` };
  } catch (e) {
    try { await respuesta.complete("fail"); } catch (e2) { /* nada */ }
    return { ok: false, mensaje: "Has pagado, pero no hemos podido activar el pase todavía. Pulsa «Restaurar compra» en unos minutos." };
  }
}

/** Vuelve a comprobar las compras de este usuario en Google Play (por si el pago se hizo y el pase no se activó). */
export async function restaurarCompra() {
  const servicio = await window.getDigitalGoodsService(PLAY);
  const compras = (await servicio.listPurchases()).filter((c) => /^pase_/.test(c.itemId));
  if (!compras.length) return { ok: false, mensaje: "Google Play no muestra ninguna compra de este pase en tu cuenta." };
  let ultimo = null;
  for (const c of compras) {
    const r = await verificarEnServidor(c.itemId, c.purchaseToken);
    if (r.ok) { await pagoHecho(); return { ok: true }; }
    ultimo = r;
  }
  return { ok: false, mensaje: ultimo?.mensaje || "No se pudo activar el pase." };
}
