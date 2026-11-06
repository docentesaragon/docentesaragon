// Configuración de la web.
// Mientras supabaseUrl esté vacío, la web usa los datos de la carpeta /data (instantánea de prueba).
// Para conectar con tu Supabase, rellena las dos líneas (ver README, paso 5).
// La clave "anon" es PÚBLICA por diseño: solo puede leer (lo garantiza supabase/schema.sql).
// NUNCA pongas aquí la clave service_role.
window.CONFIG = {
  supabaseUrl: "https://gwoamxgvnhietzhixjlf.supabase.co",      // p. ej. "https://abcdefgh.supabase.co"
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3b2FteGd2bmhpZXR6aGl4amxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MDMzMTYsImV4cCI6MjEwODQ3OTMxNn0.IKP1H-VQsCcPSr_Y-ECF4TBeHWkGziUEt3d6xAufLeg",  // la clave "anon public"
  supabaseSchema: "aragon",   // esquema de Postgres donde están las tablas (supabase/schema.sql)
  precio: "7,49 €",           // precio que se enseña (dentro de la app de Android se usa el de Google Play)
  productoPlay: "",           // vacío = automático según la fecha (pase_2026_27 hasta el 30/06/2027...)
  diasPrueba: 15,             // días de prueba gratuita (solo para el texto: el dato real está en supabase/schema.sql, «current_date + 14»)
  urlWeb: "https://docentesaragon.github.io",                 // dirección de la web para los mensajes de invitar; vacío = la de la página actual (p. ej. https://docentesaragon.github.io/)
  loginGoogle: false,         // true = enseña también «Entrar con Google» (hay que activarlo antes en Supabase; ver README)
  cuentaCompartidaCon: "DocentsCV",   // la cuenta (correo y contraseña) es la del proyecto de Supabase de esa web; "" = no mencionarla
};
