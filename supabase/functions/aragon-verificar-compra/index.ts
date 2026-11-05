// Función de servidor de Supabase (Edge Function): POST { producto, token } con la sesión del usuario.
// Lleva el prefijo "aragon-" y sus secretos "ARAGON_..." porque el proyecto de Supabase se comparte con otras webs (DocentCV):
// así no se pisan ni la función ni los secretos.
// Despliegue y secretos: ver README, "Zona de pago".
import { procesarCompra, type Entorno } from "./logica.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return responder(405, { ok: false, mensaje: "Método no permitido" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const sesion = req.headers.get("Authorization") || "";
  const quien = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: sesion, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } });
  if (!quien.ok) return responder(401, { ok: false, codigo: "sin_sesion", mensaje: "Inicia sesión para activar tu pase." });
  const usuario = await quien.json();

  let entrada: { producto?: unknown; token?: unknown };
  try { entrada = await req.json(); } catch { return responder(400, { ok: false, mensaje: "Petición no válida" }); }

  let cuentaServicio;
  try { cuentaServicio = JSON.parse(Deno.env.get("ARAGON_PLAY_SERVICE_ACCOUNT_JSON") || ""); } catch { return responder(500, { ok: false, mensaje: "Falta configurar ARAGON_PLAY_SERVICE_ACCOUNT_JSON" }); }
  const entorno: Entorno = {
    supabaseUrl: url,
    supabaseServiceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    paquete: Deno.env.get("ARAGON_PLAY_PACKAGE_NAME") || "",
    tipo: Deno.env.get("ARAGON_PLAY_TIPO") === "suscripcion" ? "suscripcion" : "pago_unico",   // curso 2026-27: pago único; la suscripción se activa cambiando el secreto
    cuentaServicio,
    esquema: "aragon",
  };
  try {
    const r = await procesarCompra(entorno, usuario.id, entrada);
    return responder(r.estado, r.cuerpo);
  } catch (e) {
    console.error("aragon-verificar-compra", e);
    return responder(502, { ok: false, codigo: "google", mensaje: "No se pudo hablar con Google Play. Inténtalo de nuevo en unos minutos." });
  }
});
