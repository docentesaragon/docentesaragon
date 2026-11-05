# Docentes Aragón

> **¿Primera vez? Empieza por `GUIA_PASO_A_PASO.html`** (o `.md`): todo el montaje explicado en orden, con comprobaciones. Este README es la referencia técnica.

Web no oficial para el profesorado interino de Aragón: hasta dónde llegó la lista en cada especialidad cada semana, qué vacantes se adjudicaron, mapa, histórico y seguimiento personal. Está hecha a imagen de DocentCV: consultar es gratis y «Mi seguimiento» es un área personal de pago (cuenta con correo y contraseña, como DocentCV; pase hasta el 30/06 de cada curso).

No publica nombres ni DNI. Solo vacantes, centros, localidades y «último llamado» por especialidad y semana.

## Qué hay en cada carpeta

| Carpeta | Para qué sirve |
|---|---|
| `web/` | La web (HTML, CSS y JavaScript, sin dependencias). Se publica en GitHub Pages. |
| `GUIA_PASO_A_PASO.html` | Guía completa para ponerlo en marcha, paso a paso. |
| `supabase/consultas_admin.sql` | Consultas para copiar en Supabase: resumen, quién ha pagado, pruebas, invitaciones, regalar/anular pases, ingresos. |
| `supabase/schema.sql` | Crea las tablas en Supabase (esquema `aragon`) y los permisos: lectura pública de los datos, y cuentas y pases privados. |
| `supabase/functions/aragon-verificar-compra/` | Función de servidor que comprueba una compra de Google Play y activa el pase. Con sus pruebas (`node --test prueba.test.ts`). |
| `pipeline/` | Los robots en Python: bajar PDF, leerlos y subirlos a Supabase. |
| `.github/workflows/` | Los robots automáticos: descarga semanal, keep-alive de Supabase y publicación de la web. |
| `datos/coords.json` | Coordenadas de las localidades (para el mapa). |
| `pruebas/` | Herramientas de prueba (servidor Supabase de mentira y pruebas del navegador). No hace falta tocarlas. |

## Cómo funciona

```
Educaragón (PDF) → pipeline/semanal.py → Supabase → web
                    descarga + lee + sube      (solo lectura)
```

1. `descargar_educaragon.py` baja los PDF nuevos de las páginas oficiales de Educaragón.
2. `procesar.py` los lee con `pdftotext`, separa interinos de funcionarios de carrera y calcula el último llamado. Los nombres se usan en memoria para cruzar adjudicados con candidatos y **no se escriben en ningún fichero de salida**.
3. `cargar_supabase.py` sube las tablas. Nunca sobrescribe datos buenos con datos peores (por ejemplo, si una semana no se pudo bajar la adjudicación).
4. La web lee de Supabase. Si Supabase no responde, muestra una copia guardada en `web/data/` y lo avisa.

## Puesta en marcha, paso a paso

### Paso 1. Crear la base de datos en Supabase

1. Entra en <https://supabase.com>, crea una cuenta y pulsa **New project**. Ponle el nombre que quieras (por ejemplo `docentes-aragon`), elige la región más cercana (Frankfurt o París) y guarda la contraseña que te pida.
2. Cuando termine de crearse, abre **SQL Editor → New query**.
3. Abre el fichero `supabase/schema.sql`, copia todo su contenido, pégalo en el editor y pulsa **Run**. Debe decir «Success». Puedes ejecutarlo más de una vez sin problema.
4. **Paso imprescindible:** ve a **Project Settings → API → Exposed schemas** (según la versión puede llamarse *Data API settings*), añade `aragon` y guarda. Sin esto la web no puede leer las tablas.

> **Se usa el proyecto de DocentCV (decisión del 5/11/2026).** El plan gratuito admite 2 proyectos activos y ya están ocupados, así que Aragón vive dentro del proyecto de DocentCV, en su propio esquema (`aragon`): las tablas no se mezclan con las de DocentCV. Para verlas, en Supabase abre **Table Editor** y elige el esquema `aragon` en el desplegable de arriba a la izquierda (cada tabla lleva una descripción). Consecuencias de compartir proyecto:
> - El keep-alive de esta web mantiene despierto también el proyecto de DocentCV.
> - Las cuentas (correo y contraseña) son las del proyecto: la web de DocentCV ya usa registro con correo de confirmación, y Aragón hace lo mismo. Solo hay que añadir la dirección de Aragón en *Redirect URLs* (ver «Zona de pago»). Google queda apagado por ahora.
> - Los usuarios son los mismos (una persona con cuenta en DocentCV entra en Aragón con la misma cuenta, pero sin pase). Por eso «Borrar mis datos» no borra el usuario.
> - La función de servidor y sus secretos llevan el prefijo `aragon` / `ARAGON_` para no pisar los de DocentCV.
> - Los 500 MB de base de datos y el límite de usuarios activos del plan gratuito se reparten entre las dos webs (ahora hay unos 75 MB usados).
> - Más adelante, si hay ingresos, se puede mover a un proyecto propio.
5. Ve a **Project Settings → API** y apunta tres cosas:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`).
   - La clave **anon public**. Es pública: irá dentro de la web.
   - La clave **service_role**. Es **secreta**: solo la usan los robots. No la pegues en la web ni en ningún fichero del repositorio.

### Paso 2. Subir el proyecto a GitHub

0. **No crees otra cuenta** (GitHub solo permite una cuenta gratuita por persona). Desde tu cuenta crea una **organización** gratuita (el «+» de arriba → *New organization* → *Free*), por ejemplo `docentesaragon`.
1. En esa organización crea un repositorio **público** llamado exactamente `docentesaragon.github.io` (el nombre de la organización + `.github.io`). Así la web se publica en la raíz, `https://docentesaragon.github.io`, igual que DocentCV. La raíz es necesaria para la app de Android.
2. Sube el contenido de esta carpeta (en la web de GitHub: **Add file → Upload files**, arrastrando las carpetas; los ficheros que empiezan por punto, como `.github`, también deben subirse).
3. Comprueba que no se ha subido ningún PDF. El `.gitignore` los excluye, pero revísalo: contienen nombres y NIF.

### Paso 3. Guardar las claves secretas en GitHub

En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**. Crea dos:

- `SUPABASE_URL`: el Project URL.
- `SUPABASE_SERVICE_KEY`: la clave `service_role`.

### Paso 4. Primera carga de datos

Hace falta cargar el histórico una vez. Tienes dos caminos.

**Camino A, el más fácil.** Me pasas el zip de PDF y yo genero los JSON y los subo contigo, como hemos hecho hasta ahora.

**Camino B, en tu ordenador (Windows).**
1. Instala Python (<https://python.org>, marca «Add Python to PATH») y Poppler: `winget install oschwartz10612.Poppler`. Si winget no lo encuentra, descarga Poppler para Windows y añade su carpeta `bin` al PATH.
2. En una ventana de PowerShell:
   ```powershell
   pip install pypdf
   $env:SUPABASE_URL = "https://TU-PROYECTO.supabase.co"
   $env:SUPABASE_SERVICE_KEY = "LA-CLAVE-SERVICE-ROLE"
   python pipeline\semanal.py --pdfs "C:\ruta\a\tus\PDF" --subir
   ```
   Sin `--subir` solo genera los JSON para que los revises.

### Paso 5. Conectar la web con Supabase

Edita `web/js/config.js` y rellena:

```js
window.CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "LA-CLAVE-ANON-PUBLICA",
  supabaseSchema: "aragon",
  precio: "7,49 €",
};
```

Con Supabase conectado, «Mi seguimiento» pasa a ser el área personal de pago (ver «Zona de pago»). Sin Supabase, la web funciona en modo de prueba: sin cuenta y con «Mi seguimiento» abierto y guardado en el navegador.

### Paso 6. Publicar la web

En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Cada vez que cambies algo dentro de `web/`, el workflow «Publicar la web» la actualiza. La dirección saldrá en esa misma pantalla.

### Paso 7. Activar los robots

En la pestaña **Actions** del repositorio:

- **Descarga semanal de Educaragón**: pulsa **Run workflow** para probarla. Después se ejecuta sola de lunes a viernes a las 17:00 UTC.
- **Keep-alive de Supabase**: pulsa **Run workflow** una vez. Después escribe en la tabla `keepalive` los lunes y jueves. Evita que Supabase (plan gratuito) pause el proyecto por inactividad.

> **Importante:** no he podido comprobar desde mi entorno si Educaragón responde a los servidores de GitHub. Si el robot semanal falla con «No se ha descargado ningún PDF», usa el camino B del paso 4 en tu ordenador cada semana (o pásame el zip).

## Zona de pago: cuenta, pase y compra con Google Play

**Lo que ve la gente.** Todas las consultas son gratis. En «Mi seguimiento» hay que entrar con correo y contraseña y tener un **pase** del curso (hasta el 30/06). Sin pase no se puede apuntar ni ver la posición en las listas ni los destinos; el servidor lo impide, no solo la pantalla. Los datos de cada persona (posición en listas y destinos) se guardan en su cuenta y solo ella los ve; no se guardan en el navegador.

**Cómo está montado.**
- *Cuenta:* Supabase Auth con correo y contraseña, igual que DocentCV: «Entrar», «Crear cuenta» (mínimo 8 caracteres, casilla de privacidad y correo de confirmación), «He olvidado mi contraseña» y pantalla de nueva contraseña, con los mismos textos. Es la misma cuenta que en DocentCV: quien ya la tiene allí entra aquí con su correo y contraseña de siempre. El código de «Entrar con Google» sigue en la web pero apagado (`loginGoogle: false` en `js/config.js`); para encenderlo más adelante hay que activar antes Google en Supabase (Authentication → Providers → Google, con una credencial OAuth «Aplicación web» de Google Cloud) y poner `loginGoogle: true`.
- *Pase:* tabla `aragon.pases`. Solo la crea la función `aragon-verificar-compra` tras comprobar la compra con Google Play. Un código de compra solo sirve para una cuenta.
- *Compra:* en la app de Android (la web empaquetada como «Trusted Web Activity») con la Digital Goods API y Google Play Billing. En el navegador del ordenador o del iPhone no se puede comprar: allí se entra con el mismo correo y contraseña y se ve el pase comprado en el móvil Android (en la app hay que entrar con esa misma cuenta antes de comprar).
- *Caducidad:* el producto `pase_2026_27` da acceso hasta el 30/06/2027; `pase_2027_28`, hasta el 30/06/2028, etc. Se venden a partir del 1 de julio.
- *Borrar datos:* botón en «Mi seguimiento». Borra el pase y el seguimiento de Docentes Aragón. No borra la cuenta (correo y contraseña), porque es compartida con DocentCV (si se borrara, también perderían su cuenta allí). Al revés, si alguien elimina su cuenta entera desde DocentCV, se borra también su pase de Aragón (las tablas `pases` y `seguimiento` dependen del usuario): conviene avisarlo en la pantalla de borrado de DocentCV. El pago sigue en Google Play: «Restaurar compra» recupera el pase mientras la compra esté vigente.

**Qué falta configurar (con tu ayuda, paso a paso cuando toque).**
1. *Cuentas con correo y contraseña:* según su web, DocentCV ya envía correos de confirmación y de recuperación, así que el envío de correos del proyecto ya está montado y Aragón lo reutiliza. Hay que hacer tres cosas en Supabase → Authentication: (a) *URL Configuration → Redirect URLs*: añadir `https://docentesaragon.github.io` y `https://docentesaragon.github.io/**` (no toques la *Site URL*, que es la de DocentCV; si falta este paso, los enlaces de los correos mandan a DocentCV); (b) *Emails → Templates*: las plantillas de «Confirm signup» y «Reset password» son de todo el proyecto, así que a quien se registre en Aragón le llegará el correo con el texto de DocentCV; hay que dejarlas con un texto neutro (por ejemplo «Docentes») o aceptarlo; (c) comprobar que *Confirm email* sigue activado y que la contraseña mínima es de 8 caracteres, como pide la web. Como la cuenta es compartida, cambiar la contraseña en una web la cambia en la otra.
2. *Google Play Console:* en la cuenta de desarrollador que ya tienes (la de DocentCV), crear la app y el producto `pase_2026_27`. **Decisión (5/11/2026): este curso, pago único** (producto de pago único, no consumible); a partir del curso 2027-28 se pasa a suscripción de prepago de 1 año (no se renueva sola; Google no permite fijar fecha de fin, así que la web corta el acceso el 30/06). Con el pago único la fecha de fin es solo nuestra (el 30/06) y queda claro para quien compra. Cada curso es un producto nuevo (`pase_2027_28`…), así que quien compró uno puede comprar el siguiente. Comisión estimada en la UE desde el 30/06/2026 según la ayuda de Google: pagos únicos 25-30 %; suscripciones con renovación automática 15 %. Hay que confirmar en Play Console cuál se aplica al prepago antes del cambio.
3. *Cuenta de servicio de Google* (Play Console → Configuración → Acceso a la API): crear una con permiso para ver datos financieros y gestionar pedidos, y descargar su clave JSON.
4. *Función de servidor:* desplegar `supabase/functions/aragon-verificar-compra` (con la CLI de Supabase: `npx supabase login` y `npx supabase functions deploy aragon-verificar-compra --project-ref TU-REF`) y guardar estos secretos en Supabase → Edge Functions → Secrets: `ARAGON_PLAY_PACKAGE_NAME` (nombre del paquete de la app), `ARAGON_PLAY_SERVICE_ACCOUNT_JSON` (el JSON entero; vale la misma cuenta de servicio que ya uses para DocentCV si tiene acceso a esta app) y `ARAGON_PLAY_TIPO` (`pago_unico` este curso, que es lo que se usa si no existe; `suscripcion` cuando se cambie). Llevan el prefijo `ARAGON_` y la función `aragon-` a propósito: el proyecto es el de DocentCV y los secretos son de todo el proyecto, así que con otro nombre se pisarían los de DocentCV.
5. *App de Android:* empaquetar la web con Bubblewrap o PWABuilder. Necesita publicar `/.well-known/assetlinks.json` en la raíz de `https://docentesaragon.github.io` (ojo: GitHub Pages por Actions puede omitir las carpetas que empiezan por punto; se resuelve al hacer este paso) y una URL de política de privacidad para la ficha de Play. Si la cuenta de desarrollador es personal y nueva, Google exige una prueba cerrada con 12 testers durante 14 días antes de publicar.

**Pruebas.** `python3 pruebas/cuenta.py` arranca un Supabase de mentira (cuentas con correo y contraseña, correos de confirmación y recuperación, pases, permisos, función de compra) y comprueba en un navegador real todo el recorrido: crear cuenta, confirmar por correo, entrar, recuperar contraseña, comprar (simulado), apuntar, sincronizar, cerrar sesión, caducidad y borrado de datos. `node --test supabase/functions/aragon-verificar-compra/prueba.test.ts` prueba la función contra una Google simulada. Lo que **no** se ha podido probar desde aquí es el Supabase real (envío real de correos y plantillas), Play Billing y la API de Play: se comprobará con cuentas de prueba al montarlo.

**Lo que aún no hace.** Anular el pase si Google reembolsa la compra (se hará con la API de compras anuladas desde el robot semanal), avisos desde la app y alertas por correo.


### Prueba gratuita e invitaciones (como DocentsCV)

- **Prueba de 15 días** al entrar por primera vez en Aragón (`aragon.cuentas.alta`; pase `tipo = 'prueba'`, un solo uso por usuario). Al cambiarlo, edita `current_date + 14` en `asegurar_cuenta()` (schema.sql) y `diasPrueba` en `config.js`.
- **Invita y consigue la app gratis:** cada cuenta tiene un código `ARA-XXXXX`. Cuando 3 personas que lo usaron compran el pase del curso, un trigger (`premiar_invitaciones`) da a quien invitó un pase `tipo = 'invitaciones'` hasta el 30/06. El código se aplica en los 30 primeros días de la cuenta, una vez, y no el propio. Enlace de invitación: `…/?ref=ARA-XXXXX` (se guarda y se aplica al registrarse).
- Funciones públicas (RPC): `mi_acceso`, `usar_codigo`, `mi_referidos`, `borrar_mis_datos`. Las internas (`asegurar_cuenta`, `aplicar_codigo`, `invitados_que_pagaron`) solo las puede llamar el servidor.
- **Pruebas de la base de datos:** `bash pruebas/rls.sh` crea un PostgreSQL temporal, carga el esquema (dos veces), ejecuta 15 pruebas de permisos y reglas y comprueba que `consultas_admin.sql` no da errores.

## Probar en tu ordenador

Doble clic en `web/abrir_local.bat` (hace falta Python). Abre `http://localhost:8000`. Abrir `index.html` con doble clic **no** funciona: los navegadores bloquean la carga de datos desde un fichero local.

## Mantenimiento

- **Localidades nuevas.** Si en el registro aparece `AVISO localidades sin coordenadas`, añade esa localidad a `datos/coords.json` con `"NOMBRE": [latitud, longitud]`. Mientras tanto sale en la lista pero no en el mapa.
- **Cambios de formato de Educaragón.** Si un PDF cambia de diseño, `procesar.py` puede dejar de leerlo bien. Pásame el PDF y se ajusta `parsers.py`.
- **Si ya tenías creada la base de datos** de una versión anterior, vuelve a ejecutar `supabase/schema.sql` entero: añade la columna `reconstruido` sin tocar tus datos.
- **Nuevo curso.** No hace falta tocar nada: el curso se deduce de las fechas.

## Privacidad

- Los PDF de Educaragón llevan nombre y NIF parcial de las personas. Esta web publica solo datos agregados.
- No hay buscador por nombre ni se pide DNI.
- «Mi seguimiento» guarda la posición y los destinos de cada persona en su cuenta de Supabase (tabla `aragon.seguimiento`, protegida: solo la ve su dueña y solo con pase en vigor). Del navegador solo se guarda la sesión y la preferencia Maestros/Secundaria. De cada cuenta guardamos el correo y la contraseña (cifrada por Supabase), más la fecha y versión de la privacidad aceptada. Hay botón para borrar el pase y todos los datos; la cuenta en sí, al ser compartida con DocentCV, se elimina a petición.
- `web/privacidad.html` es un borrador hecho a partir de la política de DocentsCV (mismo responsable «Fuxters» y mismo correo de contacto): léela y cámbiala antes de publicar. Cada vez que cambie de forma importante, sube la versión (`VERSION_PRIVACIDAD` en `js/cuenta.js`).
- Con cuentas de usuario aplica el RGPD: política de privacidad (también la pide Google Play), responsable del tratamiento y atención al derecho de supresión. Cobrar es actividad económica: conviene consultarlo con un gestor (alta de autónomo, IVA, IRPF). Google dice que cobra y liquida el IVA al comprador en la UE.
- El mapa no usa servicios externos de mapas, así que no se envía ninguna dirección IP a terceros. El único enlace externo es «Abrir en OpenStreetMap», que solo se carga si lo pulsas.
- No soy abogado: antes de abrir la web al público, conviene que revises con alguien de confianza el aviso legal y la política de privacidad.

## Lo que hay que saber de los datos

- **Último llamado** = la posición más lejana de la lista entre quienes obtuvieron una vacante ordinaria esa semana. Las singularizadas no cuentan.
- **Posición en la lista** = lista (1 o 2) + fecha del bloque + bloque + orden dentro del bloque. Es estable de una semana a otra, a diferencia de la columna «Relación» del PDF.
- En Secundaria hay personas adjudicadas en una especialidad distinta a la de su lista. Se asignan a su lista solo cuando no hay duda; las demás quedan sin asignar (columna `sin_resolver`) y el último llamado puede quedarse algo corto.
- **Semanas sin listado de candidatos.** A veces Educaragón publica la adjudicación pero no el PDF de candidatos de esa semana (en 2026-27: Maestros del 22/10 y del 26/10). En esos casos el último llamado se **calcula** con las posiciones que esas mismas personas ocupan en las listas de otras semanas. Acierta en torno al 92 % de las veces cuando se prueba con semanas que sí tienen candidatos (`python3 pipeline/procesar.py CARPETA --salida /tmp/x --validar`). En la web esas filas llevan el aviso «calculado con listas de otras semanas» y no muestran «convocados» ni el número de relación. Si más adelante aparece el PDF de candidatos, el siguiente `semanal.py` lo sustituye por el dato real (`reconstruido = false`).
- Los cursos anteriores a 2026-27 están incompletos: solo están las semanas que has podido descargar.
