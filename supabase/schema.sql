-- =====================================================================
--  Docentes Aragón · esquema de la base de datos (Supabase / Postgres)
--  Pégalo ENTERO en  Supabase > SQL Editor > New query > Run.
--  Se puede ejecutar más de una vez sin romper nada.
--
--  Importante de privacidad: aquí NO hay nombres ni DNI. Solo vacantes,
--  centros, localidades y el "último llamado" por especialidad y semana.
--
--  Todo vive en un esquema propio, "aragon", para poder compartir proyecto de
--  Supabase con otras webs (DocentCV, Justicia CV...) sin que las tablas se pisen.
--  DESPUÉS de ejecutar esto: Project Settings > API > "Exposed schemas" > añade
--  "aragon" > Save.  (Sin ese paso la web no puede leer las tablas.)
-- =====================================================================

create schema if not exists aragon;

-- Un registro por cada "acto" (oferta semanal) de interinos: PRI = Maestros, SEC = Secundaria y resto.
create table if not exists aragon.actos (
  acto                     text primary key,        -- p. ej. PRI-2026-37
  cuerpo                   text not null,           -- 'maestros' | 'secundaria'
  fecha_oferta             date not null,           -- día en que se publica la oferta
  fecha_adjudicacion       date,                    -- día en que se publica la adjudicación
  curso                    text not null,           -- p. ej. 2026-27
  n_ofertadas              int,
  n_adjudicadas            int,
  n_singulares_adjudicadas int,
  n_no_adjudicadas         int,
  n_convocados             int,
  tiene_candidatos         boolean default false,
  tiene_adjudicadas        boolean default false
);

create table if not exists aragon.cuerpos (
  cod    text primary key,                          -- 0597, 0590...
  nombre text not null
);

create table if not exists aragon.especialidades (
  cuerpo_cod text not null,                         -- 0597 Maestros, 0590 Secundaria...
  cod        text not null,                         -- AL, FI, 001, 115...
  nombre     text not null,
  primary key (cuerpo_cod, cod)
);

create table if not exists aragon.localidades (
  localidad text not null,
  provincia text not null,
  lat       double precision,
  lon       double precision,
  aprox     boolean default false,                  -- true = coordenadas aproximadas
  primary key (localidad, provincia)
);

-- Una fila por vacante. "estado" cambia de ofertada -> adjudicada / no_adjudicada.
create table if not exists aragon.vacantes (
  id                 text primary key,              -- acto|cuerpo|O/S|nº de vacante
  acto               text not null references aragon.actos(acto) on delete cascade,
  curso              text not null,
  cuerpo_cod         text not null,
  esp                text,
  vacante            int  not null,
  singular           int  not null default 0,       -- 1 = vacante singularizada (perfil especial)
  estado             text not null,                 -- ofertada | adjudicada | no_adjudicada
  centro_cod         text,
  centro             text,
  localidad          text,
  provincia          text,
  jornada            text,
  duracion           text,
  obligacion         text,
  causa              text,
  perfilada          text,
  perfil             text,
  fecha_fin_estimada date
);
create index if not exists vacantes_curso_idx on aragon.vacantes (curso);
create index if not exists vacantes_acto_idx  on aragon.vacantes (acto);
create index if not exists vacantes_esp_idx   on aragon.vacantes (cuerpo_cod, esp);

-- Hasta dónde llegó la lista en cada especialidad y semana.
--   clave_ultimo         = posición (lista-fecha bloque-bloque-orden) del último llamado
--   clave_max_convocado  = posición del último candidato preseleccionado
create table if not exists aragon.ultimo_llamado (
  acto                text not null references aragon.actos(acto) on delete cascade,
  cuerpo_cod          text not null,
  esp                 text not null,
  convocados          int,
  clave_max_convocado text,
  vacantes            int,
  adjudicadas         int,
  llamados            int,
  llamados_otra_esp   int,
  sin_resolver        int,
  clave_ultimo        text,
  relacion_ultimo     int,
  reconstruido        boolean default false,   -- true = calculado con listas de otras semanas (esa semana no hay candidatos)
  primary key (acto, cuerpo_cod, esp)
);
-- Por si la tabla ya existía de antes:
alter table aragon.ultimo_llamado add column if not exists reconstruido boolean default false;

-- Tabla del "keep-alive": un robot de GitHub la toca dos veces por semana para que
-- Supabase (plan gratuito) no pause el proyecto por inactividad.
create table if not exists aragon.keepalive (
  id          int primary key,
  ultimo_ping timestamptz not null default now()
);
insert into aragon.keepalive (id) values (1) on conflict (id) do nothing;

-- =====================================================================
--  Cuentas de usuario: pase de pago y "Mi seguimiento" sincronizado.
--  Las cuentas las gestiona Supabase Auth (correo y contraseña, como DocentCV); aquí solo se guarda lo nuestro.
-- =====================================================================

-- Un pase = acceso a "Mi seguimiento". Tipos:
--   suscripcion / pago_unico : compra en Google Play; la crea la función de servidor "aragon-verificar-compra"
--                              (con la clave service_role) tras comprobarla. Caduca el 30/06 del curso.
--   prueba                   : 15 días gratis la primera vez que alguien entra (la crea mi_acceso()).
--   invitaciones             : app gratis este curso por haber invitado a 3 personas que pagan (la crea un trigger).
--   manual                   : acceso regalado por el administrador (ver supabase/consultas_admin.sql).
-- Desde la web nadie puede crear ni modificar pases.
create table if not exists aragon.pases (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  curso     text not null,                          -- p. ej. 2026-27
  producto  text not null,                          -- id del producto en Google Play, p. ej. pase_2026_27
  tipo      text not null check (tipo in ('suscripcion', 'pago_unico', 'manual', 'prueba', 'invitaciones')),
  token     text unique,                            -- token de compra de Google Play (una compra, una cuenta)
  expira    date not null,                          -- último día con acceso (30/06)
  estado    text not null default 'activo' check (estado in ('activo', 'anulado')),
  creado    timestamptz not null default now()
);
create index if not exists pases_user_idx on aragon.pases (user_id);
-- Por si el esquema se creó con una versión anterior (sin prueba ni invitaciones):
alter table aragon.pases drop constraint if exists pases_tipo_check;
alter table aragon.pases add  constraint pases_tipo_check check (tipo in ('suscripcion', 'pago_unico', 'manual', 'prueba', 'invitaciones'));
create unique index if not exists pases_una_prueba          on aragon.pases (user_id)        where tipo = 'prueba';
create unique index if not exists pases_una_por_invitacion  on aragon.pases (user_id, curso) where tipo = 'invitaciones';

-- Lo que cada persona sigue (su posición en listas y sus destinos). Solo ella lo ve.
create table if not exists aragon.seguimiento (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  datos       jsonb not null default '{}'::jsonb check (octet_length(datos::text) <= 100000),
  actualizado timestamptz not null default now()
);

-- Administradores: solo estos correos (y confirmados) ven la administración y pueden usar las funciones admin_*.
-- Para añadir otro: insert into aragon.admins (email) values ('otro@correo.com');  (en minúsculas)
create table if not exists aragon.admins (
  email text primary key check (email = lower(email))
);
insert into aragon.admins (email) values ('docentscv@gmail.com') on conflict do nothing;

create or replace function aragon.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u join aragon.admins a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- ¿Tiene la persona que hace la consulta un pase en vigor? (el administrador siempre)
create or replace function aragon.tiene_pase() returns boolean
language sql stable security definer set search_path = '' as $$
  select aragon.es_admin() or exists (
    select 1 from aragon.pases p
    where p.user_id = auth.uid() and p.estado = 'activo' and p.expira >= current_date
  );
$$;


-- Una fila por persona que ha entrado alguna vez en Docentes Aragón: cuándo empezó su prueba, su código para invitar
-- y quién la invitó. La crea la función mi_acceso(); desde la web nadie escribe aquí directamente.
create table if not exists aragon.cuentas (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  codigo          text not null unique,                                   -- código de invitación, p. ej. ARA-7K2QX
  alta            timestamptz not null default now(),                     -- primera entrada: empieza la prueba de 15 días
  referido_por    uuid references aragon.cuentas(user_id) on delete set null,   -- quién la invitó
  codigo_usado_el timestamptz
);
-- Nombre tal como sale en las listas de Educaragón (para encontrar tus especialidades solo). Solo lo ve su dueña y el administrador.
alter table aragon.cuentas add column if not exists nombre text check (nombre is null or char_length(nombre) between 5 and 120);
alter table aragon.cuentas add column if not exists cambios_nombre int not null default 0;     -- veces que ella ha cambiado el nombre (máx. 3; el administrador puede corregirlo)
alter table aragon.cuentas add column if not exists nombre_cambiado timestamptz;
alter table aragon.cuentas add column if not exists busq_dia date;                              -- día de las búsquedas de abajo
alter table aragon.cuentas add column if not exists busq_n int not null default 0;             -- búsquedas de ese día (máx. 5)

-- ---------------------------------------------------------------------
--  Prueba gratuita (15 días) e invitaciones («invita y consigue la app gratis», como DocentsCV):
--  si 3 personas se registran con tu código Y PAGAN, tu curso es gratis.
-- ---------------------------------------------------------------------

-- Curso escolar de una fecha (1 de julio a 30 de junio): 2026-11-05 -> '2026-27'; 2027-03-01 -> '2026-27'.
create or replace function aragon.curso_de(p_dia date default current_date) returns text
language sql immutable set search_path = '' as $$
  select case when extract(month from p_dia) >= 7
              then extract(year from p_dia)::int::text || '-' || lpad(((extract(year from p_dia)::int + 1) % 100)::text, 2, '0')
              else (extract(year from p_dia)::int - 1)::text || '-' || lpad((extract(year from p_dia)::int % 100)::text, 2, '0') end;
$$;

-- Código de invitación nuevo: ARA- + 5 caracteres sin letras que se confundan (sin 0/O, 1/I).
create or replace function aragon.nuevo_codigo() returns text
language plpgsql volatile set search_path = '' as $$
declare alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := 'ARA-';
    for i in 1..5 loop c := c || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1); end loop;
    exit when not exists (select 1 from aragon.cuentas where codigo = c);
  end loop;
  return c;
end;
$$;

-- Crea la cuenta de la persona la primera vez (con su código y su prueba de 15 días). Devuelve true si la acaba de crear.
create or replace function aragon.asegurar_cuenta(p_yo uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare creada int;
begin
  insert into aragon.cuentas (user_id, codigo) values (p_yo, aragon.nuevo_codigo()) on conflict (user_id) do nothing;
  get diagnostics creada = row_count;
  if creada = 0 then return false; end if;
  -- 15 días contando hoy: si entra hoy, el último día con acceso es dentro de 14 días.
  insert into aragon.pases (user_id, curso, producto, tipo, expira)
  values (p_yo, aragon.curso_de(), 'prueba', 'prueba', current_date + 14) on conflict do nothing;
  return true;
end;
$$;

-- Aplica el código de invitación de otra persona. Devuelve: ok | no_existe | propio | ya_usado | circular | caducado.
-- Solo se puede usar en los primeros 30 días de la cuenta y una sola vez.
create or replace function aragon.aplicar_codigo(p_yo uuid, p_codigo text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare mia aragon.cuentas%rowtype; suya aragon.cuentas%rowtype;
begin
  select * into mia from aragon.cuentas where user_id = p_yo;
  if not found then return 'no_existe'; end if;
  select * into suya from aragon.cuentas where codigo = upper(btrim(coalesce(p_codigo, '')));
  if not found then return 'no_existe'; end if;
  if suya.user_id = p_yo then return 'propio'; end if;
  if mia.referido_por is not null then return 'ya_usado'; end if;
  if suya.referido_por = p_yo then return 'circular'; end if;      -- esa persona se registró con tu código
  if mia.alta < now() - interval '30 days' then return 'caducado'; end if;
  update aragon.cuentas set referido_por = suya.user_id, codigo_usado_el = now() where user_id = p_yo;
  return 'ok';
end;
$$;

-- Cuántas personas invitadas por p_user tienen un pase de pago activo del curso p_curso.
create or replace function aragon.invitados_que_pagaron(p_user uuid, p_curso text) returns int
language sql stable security definer set search_path = '' as $$
  select count(distinct c.user_id)::int
  from aragon.cuentas c join aragon.pases p on p.user_id = c.user_id
  where c.referido_por = p_user and p.curso = p_curso and p.tipo in ('suscripcion', 'pago_unico') and p.estado = 'activo';
$$;

-- La web la llama cada vez que alguien entra: crea la cuenta y la prueba la primera vez, aplica el código de
-- invitación con el que se registró (user_metadata.codigo_invitacion_aragon) y guarda el nombre que puso al
-- registrarse (user_metadata.nombre_aragon).
create or replace function aragon.mi_acceso() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare yo uuid := auth.uid(); nueva boolean; cod text; nom text; resultado text := null; res_nombre text := null;
begin
  if yo is null then raise exception 'No has iniciado sesión'; end if;
  nueva := aragon.asegurar_cuenta(yo);
  if nueva then
    cod := nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'codigo_invitacion_aragon', '')), '');
    if cod is not null then resultado := aragon.aplicar_codigo(yo, cod); end if;
    nom := nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'nombre_aragon', '')), '');
    if nom is not null then res_nombre := aragon.fijar_nombre(yo, nom, true); end if;
  end if;
  return jsonb_build_object('nueva', nueva, 'codigo_invitacion', resultado, 'nombre', res_nombre);
end;
$$;

-- «Usar código» (pantalla de invitaciones): ok | no_existe | propio | ya_usado | circular | caducado.
create or replace function aragon.usar_codigo(p_codigo text) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  perform aragon.asegurar_cuenta(auth.uid());
  return aragon.aplicar_codigo(auth.uid(), p_codigo);
end;
$$;

-- Datos de la tarjeta «Invita y consigue la app gratis».
create or replace function aragon.mi_referidos() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare yo uuid := auth.uid(); c aragon.cuentas%rowtype;
begin
  if yo is null then raise exception 'No has iniciado sesión'; end if;
  perform aragon.asegurar_cuenta(yo);
  select * into c from aragon.cuentas where user_id = yo;
  return jsonb_build_object(
    'codigo', c.codigo,
    'necesarios', 3,
    'invitados', (select count(*) from aragon.cuentas x where x.referido_por = yo),
    'pagados', aragon.invitados_que_pagaron(yo, aragon.curso_de()),
    'gratis', exists (select 1 from aragon.pases p where p.user_id = yo and p.tipo = 'invitaciones' and p.curso = aragon.curso_de()),
    'usado', c.referido_por is not null,
    'puede_usar', c.referido_por is null and c.alta >= now() - interval '30 days');
end;
$$;

-- Cuando alguien paga, si quien la invitó ya tiene 3 invitadas que han pagado ese curso, se le regala el curso.
create or replace function aragon.premiar_invitaciones() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare quien uuid;
begin
  if new.tipo not in ('suscripcion', 'pago_unico') or new.estado <> 'activo' then return new; end if;
  select referido_por into quien from aragon.cuentas where user_id = new.user_id;
  if quien is null then return new; end if;
  if aragon.invitados_que_pagaron(quien, new.curso) >= 3 then
    insert into aragon.pases (user_id, curso, producto, tipo, expira)
    values (quien, new.curso, 'invitaciones', 'invitaciones', make_date(2000 + right(new.curso, 2)::int, 6, 30))
    on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists pases_premiar_invitaciones on aragon.pases;
create trigger pases_premiar_invitaciones after insert on aragon.pases
  for each row execute function aragon.premiar_invitaciones();

-- =====================================================================
--  Mi seguimiento v2: nombre, búsqueda automática de tus listas, mensajes y administración
-- =====================================================================

-- Nombre normalizado para comparar: sin tildes ni signos, en mayúsculas y con las palabras ordenadas
-- ("García López, María" = "GARCIA LOPEZ, MARIA" = "María García López").
create or replace function aragon.clave_nombre(p_nombre text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(t, ' ' order by t), '')
  from regexp_split_to_table(
         btrim(regexp_replace(upper(translate(coalesce(p_nombre, ''),
           'áàäâéèëêíìïîóòöôúùüûñçÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ', 'aaaaeeeeiiiioooouuuuncAAAAEEEEIIIIOOOOUUUUNC')),
           '[^A-Z]+', ' ', 'g')), ' +') as t
  where t <> '';
$$;

-- Personas que han salido en algún listado de candidatos del curso: nombre normalizado + su posición en cada lista.
-- PRIVADA: ni anon ni authenticated pueden leerla; solo la leen las funciones de abajo (y el robot, con service_role).
-- No se guarda el nombre escrito tal cual ni el DNI: solo el nombre normalizado y el DNI parcial que ya publica Educaragón (p. ej. ***1285**).
create table if not exists aragon.personas (
  curso      text not null,
  clave      text not null,
  nif        text not null default '',
  cuerpo_cod text not null,
  esp        text not null,
  clave_pos  text not null check (clave_pos ~ '^[0-9]-[0-9]{8}-[0-9]{3}-[0-9]{5}$'),
  visto      date not null default current_date,
  primary key (curso, clave, nif, cuerpo_cod, esp)
);
create index if not exists personas_clave_idx on aragon.personas (curso, clave);

-- Personas que han pedido que no se las incluya en la búsqueda (aunque sigan saliendo en los PDF de Educaragón).
-- nif vacío = todas las personas con ese nombre normalizado; con valor = solo la que tiene ese DNI parcial. Privada, como personas.
create table if not exists aragon.personas_excluidas (
  clave  text not null,
  nif    text not null default '',
  creado date not null default current_date,
  primary key (clave, nif)
);

-- La usa el robot (service_role) para cargar los candidatos de la semana: [{nombre, nif, cuerpo_cod, esp, clave}, ...].
-- Calcula aquí el nombre normalizado y no guarda el nombre original. Borra lo de cursos anteriores.
create or replace function aragon.cargar_personas(p_curso text, p_filas jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  insert into aragon.personas (curso, clave, nif, cuerpo_cod, esp, clave_pos)
  select distinct on (k, nif, f->>'cuerpo_cod', f->>'esp') p_curso, k, nif, f->>'cuerpo_cod', f->>'esp', f->>'clave'
  from (select f, aragon.clave_nombre(f->>'nombre') as k, coalesce(f->>'nif', '') as nif from jsonb_array_elements(p_filas) f) q
  where k <> ''
    and not exists (select 1 from aragon.personas_excluidas x where x.clave = q.k and (x.nif = '' or x.nif = q.nif))
  order by k, nif, f->>'cuerpo_cod', f->>'esp', f->>'clave' desc
  on conflict (curso, clave, nif, cuerpo_cod, esp) do update set clave_pos = excluded.clave_pos, visto = current_date;
  get diagnostics n = row_count;
  delete from aragon.personas where curso < p_curso;
  delete from aragon.personas p using aragon.personas_excluidas x where p.clave = x.clave and (x.nif = '' or x.nif = p.nif);
  return n;
end;
$$;

-- Guarda el nombre de una cuenta (uso interno). Devuelve ok | invalido | limite.
-- p_contar = true cuenta el cambio (máx. 3); el administrador corrige sin contar y reinicia el contador.
create or replace function aragon.fijar_nombre(p_yo uuid, p_nombre text, p_contar boolean) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')); k text := aragon.clave_nombre(btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')));
        c aragon.cuentas%rowtype;
begin
  if char_length(v) < 5 or char_length(v) > 120 or coalesce(array_length(string_to_array(k, ' '), 1), 0) < 2 then return 'invalido'; end if;
  perform aragon.asegurar_cuenta(p_yo);
  select * into c from aragon.cuentas where user_id = p_yo for update;
  if c.nombre is not null and aragon.clave_nombre(c.nombre) = k then
    -- la misma persona: solo cambia cómo está escrito (si lo corrige el administrador, además se reinician los límites)
    update aragon.cuentas set nombre = v,
           cambios_nombre = case when p_contar then c.cambios_nombre else 0 end,
           busq_dia = case when p_contar then c.busq_dia else null end, busq_n = case when p_contar then c.busq_n else 0 end
     where user_id = p_yo;
    return 'ok';
  end if;
  if p_contar and c.cambios_nombre >= 3 then return 'limite'; end if;
  update aragon.cuentas set nombre = v, nombre_cambiado = now(),
         cambios_nombre = case when p_contar then c.cambios_nombre + 1 else 0 end,
         busq_dia = case when p_contar then c.busq_dia else null end, busq_n = case when p_contar then c.busq_n else 0 end
   where user_id = p_yo;
  return 'ok';
end;
$$;

-- «Mi nombre en las listas»: guarda el nombre de la persona que hace la consulta. { estado: ok | invalido | limite }
create or replace function aragon.guardar_nombre(p_nombre text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  return jsonb_build_object('estado', aragon.fijar_nombre(auth.uid(), p_nombre, true));
end;
$$;

-- Lo que la web necesita saber de la cuenta: nombre guardado, cambios y búsquedas que le quedan, y si es administradora.
create or replace function aragon.mi_perfil() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare yo uuid := auth.uid(); c aragon.cuentas%rowtype;
begin
  if yo is null then raise exception 'No has iniciado sesión'; end if;
  perform aragon.asegurar_cuenta(yo);
  select * into c from aragon.cuentas where user_id = yo;
  return jsonb_build_object('nombre', c.nombre, 'cambios_restantes', greatest(0, 3 - c.cambios_nombre),
    'busquedas_restantes', greatest(0, 5 - case when c.busq_dia = current_date then c.busq_n else 0 end), 'admin', aragon.es_admin());
end;
$$;

-- Busca en las listas del curso a la persona con el nombre de ESTA cuenta (nunca un nombre cualquiera) y devuelve sus
-- posiciones. Máximo 5 búsquedas al día. Si hay varias personas con el mismo nombre, pide las 4 cifras del DNI que salen en las listas.
-- { estado: ok | sin_nombre | sin_pase | limite | no_encontrado | varios, listas: [{cuerpo_cod, esp, clave}], restantes: n }
create or replace function aragon.buscar_mis_listas(p_nif text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare yo uuid := auth.uid(); c aragon.cuentas%rowtype; k text; v_curso text := aragon.curso_de(); hoy int; nifn text := upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')); n_personas int; v_listas jsonb;
begin
  if yo is null then raise exception 'No has iniciado sesión'; end if;
  if not aragon.tiene_pase() then return jsonb_build_object('estado', 'sin_pase'); end if;
  select * into c from aragon.cuentas where user_id = yo for update;
  if not found or c.nombre is null then return jsonb_build_object('estado', 'sin_nombre'); end if;
  hoy := case when c.busq_dia = current_date then c.busq_n else 0 end;
  if hoy >= 5 then return jsonb_build_object('estado', 'limite', 'restantes', 0); end if;
  update aragon.cuentas set busq_dia = current_date, busq_n = hoy + 1 where user_id = yo;
  k := aragon.clave_nombre(c.nombre);
  select count(distinct p.nif) into n_personas from aragon.personas p
   where p.curso = v_curso and p.clave = k and (nifn = '' or upper(regexp_replace(p.nif, '[^A-Za-z0-9]', '', 'g')) like '%' || nifn || '%');
  if n_personas = 0 then return jsonb_build_object('estado', 'no_encontrado', 'restantes', 4 - hoy, 'con_dni', nifn <> ''); end if;
  if n_personas > 1 then return jsonb_build_object('estado', 'varios', 'restantes', 4 - hoy); end if;
  select jsonb_agg(jsonb_build_object('cuerpo_cod', p.cuerpo_cod, 'esp', p.esp, 'clave', p.clave_pos) order by p.cuerpo_cod, p.esp) into v_listas
    from aragon.personas p
   where p.curso = v_curso and p.clave = k and (nifn = '' or upper(regexp_replace(p.nif, '[^A-Za-z0-9]', '', 'g')) like '%' || nifn || '%');
  return jsonb_build_object('estado', 'ok', 'listas', v_listas, 'restantes', 4 - hoy);
end;
$$;

-- Sugerencias y reclamaciones que la gente manda desde Ajustes.
create table if not exists aragon.mensajes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tipo       text not null check (tipo in ('sugerencia', 'reclamacion')),
  texto      text not null check (char_length(texto) between 5 and 2000),
  estado     text not null default 'nuevo' check (estado in ('nuevo', 'visto', 'resuelto')),
  respuesta  text check (respuesta is null or char_length(respuesta) <= 2000),
  creado     timestamptz not null default now(),
  respondido timestamptz
);
create index if not exists mensajes_user_idx on aragon.mensajes (user_id);

-- Máximo 5 mensajes cada 24 horas por cuenta. { estado: ok | invalido | limite }
create or replace function aragon.enviar_mensaje(p_tipo text, p_texto text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t text := btrim(coalesce(p_texto, ''));
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  if p_tipo not in ('sugerencia', 'reclamacion') or char_length(t) < 5 or char_length(t) > 2000 then return jsonb_build_object('estado', 'invalido'); end if;
  if (select count(*) from aragon.mensajes where user_id = auth.uid() and creado > now() - interval '24 hours') >= 5 then return jsonb_build_object('estado', 'limite'); end if;
  perform aragon.asegurar_cuenta(auth.uid());
  insert into aragon.mensajes (user_id, tipo, texto) values (auth.uid(), p_tipo, t);
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- ---------------------------------------------------------------------
--  Administración (solo aragon.admins). Cada función comprueba que quien llama es administrador.
-- ---------------------------------------------------------------------
create table if not exists aragon.admin_log (
  id      bigint generated always as identity primary key,
  admin   uuid not null,
  accion  text not null,
  user_id uuid,
  detalle text,
  momento timestamptz not null default now()
);

create or replace function aragon.exigir_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not aragon.es_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
end;
$$;

-- Lista de personas con su estado de acceso. p_buscar filtra por correo o nombre.
create or replace function aragon.admin_usuarios(p_buscar text default null, p_limite int default 200, p_desde int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_buscar, ''))); total int; filas jsonb;
begin
  perform aragon.exigir_admin();
  select count(*) into total from aragon.cuentas c join auth.users u on u.id = c.user_id
   where q = '' or position(q in lower(u.email)) > 0 or position(q in lower(coalesce(c.nombre, ''))) > 0;
  select coalesce(jsonb_agg(s.fila order by s.alta desc), '[]'::jsonb) into filas from (
    select c.alta, jsonb_build_object(
      'user_id', c.user_id, 'email', u.email, 'nombre', c.nombre, 'alta', c.alta, 'ultimo_acceso', u.last_sign_in_at, 'codigo', c.codigo,
      'invitados', (select count(*) from aragon.cuentas x where x.referido_por = c.user_id),
      'invitado_por', (select u2.email from auth.users u2 where u2.id = c.referido_por),
      'pase_tipo', p.tipo, 'pase_expira', p.expira, 'pase_vigente', coalesce(p.estado = 'activo' and p.expira >= current_date, false),
      'pagado', exists (select 1 from aragon.pases z where z.user_id = c.user_id and z.tipo in ('suscripcion', 'pago_unico') and z.estado = 'activo'),
      'mensajes', (select count(*) from aragon.mensajes m where m.user_id = c.user_id)) as fila
    from aragon.cuentas c join auth.users u on u.id = c.user_id
    left join lateral (select z.tipo, z.expira, z.estado from aragon.pases z where z.user_id = c.user_id
                       order by (z.estado = 'activo' and z.expira >= current_date) desc, z.expira desc limit 1) p on true
    where q = '' or position(q in lower(u.email)) > 0 or position(q in lower(coalesce(c.nombre, ''))) > 0
    order by c.alta desc offset greatest(p_desde, 0) limit least(greatest(p_limite, 1), 500)) s;
  return jsonb_build_object('total', total, 'filas', filas);
end;
$$;

-- Cifras de arriba de «Usuarios y pagos».
create or replace function aragon.admin_resumen() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform aragon.exigir_admin();
  return jsonb_build_object(
    'cuentas', (select count(*) from aragon.cuentas),
    'hoy', (select count(*) from aragon.cuentas where alta::date = current_date),
    'ultimos_7', (select count(*) from aragon.cuentas where alta > now() - interval '7 days'),
    'en_prueba', (select count(distinct user_id) from aragon.pases where tipo = 'prueba' and estado = 'activo' and expira >= current_date
                    and user_id not in (select user_id from aragon.pases where tipo in ('suscripcion', 'pago_unico', 'invitaciones', 'manual') and estado = 'activo' and expira >= current_date)),
    'pagando', (select count(distinct user_id) from aragon.pases where tipo in ('suscripcion', 'pago_unico') and estado = 'activo' and expira >= current_date),
    'gratis_invitaciones', (select count(distinct user_id) from aragon.pases where tipo = 'invitaciones' and estado = 'activo' and expira >= current_date),
    'regalados', (select count(distinct user_id) from aragon.pases where tipo = 'manual' and estado = 'activo' and expira >= current_date),
    'sin_acceso', (select count(*) from aragon.cuentas c where not exists (select 1 from aragon.pases p where p.user_id = c.user_id and p.estado = 'activo' and p.expira >= current_date)),
    'con_nombre', (select count(*) from aragon.cuentas where nombre is not null));
end;
$$;

-- Embudo sin visitas: registro -> prueba -> uso -> pago.
create or replace function aragon.admin_embudo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare registros int; prueba int; uso int; pago int;
begin
  perform aragon.exigir_admin();
  select count(*) into registros from aragon.cuentas;
  select count(distinct user_id) into prueba from aragon.pases where tipo = 'prueba';
  select count(*) into uso from aragon.seguimiento s where s.datos <> '{}'::jsonb and (jsonb_array_length(coalesce(s.datos -> 'listas', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(s.datos -> 'destinos', '[]'::jsonb)) > 0);
  select count(distinct user_id) into pago from aragon.pases where tipo in ('suscripcion', 'pago_unico') and estado = 'activo';
  return jsonb_build_array(
    jsonb_build_object('etapa', 'Se registraron', 'n', registros),
    jsonb_build_object('etapa', 'Empezaron la prueba gratuita', 'n', prueba),
    jsonb_build_object('etapa', 'Usaron Mi seguimiento (guardaron listas o destinos)', 'n', uso),
    jsonb_build_object('etapa', 'Pagaron', 'n', pago));
end;
$$;

-- Pruebas terminadas sin pagar: cuentas con 22 días o más desde el alta (15 de prueba + una semana), sin pase de pago, invitaciones ni regalo vigentes.
create or replace function aragon.admin_pruebas_terminadas(p_dias int default 22) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare filas jsonb;
begin
  perform aragon.exigir_admin();
  select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'email', u.email, 'nombre', c.nombre, 'alta', c.alta,
           'dias', (current_date - c.alta::date), 'prueba_hasta', (select max(expira) from aragon.pases z where z.user_id = c.user_id and z.tipo = 'prueba')) order by c.alta), '[]'::jsonb) into filas
  from aragon.cuentas c join auth.users u on u.id = c.user_id
  where c.alta <= now() - make_interval(days => greatest(p_dias, 0))
    and not exists (select 1 from aragon.pases z where z.user_id = c.user_id and z.estado = 'activo' and z.expira >= current_date and z.tipo <> 'prueba')
    and not exists (select 1 from aragon.pases z where z.user_id = c.user_id and z.tipo in ('suscripcion', 'pago_unico') and z.estado = 'activo');
  return filas;
end;
$$;

-- Acciones sobre una persona. p_accion: regalar | ampliar_prueba | anular | nombre.  Devuelve un texto corto con el resultado.
create or replace function aragon.admin_accion(p_user uuid, p_accion text, p_valor text default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare yo uuid := auth.uid(); res text; fin date; dias int;
begin
  perform aragon.exigir_admin();
  if not exists (select 1 from aragon.cuentas where user_id = p_user) then return 'no_existe'; end if;
  if p_accion = 'regalar' then
    fin := make_date(2000 + right(aragon.curso_de(), 2)::int, 6, 30);
    if exists (select 1 from aragon.pases where user_id = p_user and tipo = 'manual' and estado = 'activo' and expira >= current_date) then res := 'ya_tiene';
    else
      insert into aragon.pases (user_id, curso, producto, tipo, expira) values (p_user, aragon.curso_de(), 'regalo', 'manual', fin);
      res := 'ok';
    end if;
  elsif p_accion = 'ampliar_prueba' then
    dias := coalesce(nullif(p_valor, '')::int, 15);
    if dias < 1 or dias > 60 then return 'invalido'; end if;
    update aragon.pases set expira = greatest(expira, current_date) + dias, estado = 'activo' where user_id = p_user and tipo = 'prueba';
    if not found then
      insert into aragon.pases (user_id, curso, producto, tipo, expira) values (p_user, aragon.curso_de(), 'prueba', 'prueba', current_date + dias - 1);
    end if;
    res := 'ok';
  elsif p_accion = 'anular' then
    update aragon.pases set estado = 'anulado' where user_id = p_user and estado = 'activo';
    res := 'ok';
  elsif p_accion = 'nombre' then
    res := aragon.fijar_nombre(p_user, p_valor, false);
  else
    return 'invalido';
  end if;
  insert into aragon.admin_log (admin, accion, user_id, detalle) values (yo, p_accion, p_user, case when p_accion = 'nombre' then null else p_valor end);
  return res;
end;
$$;

-- «Ver la web como otra persona» (solo lectura): sus listas y destinos, y su estado de acceso. Queda anotado en admin_log.
create or replace function aragon.admin_ver_seguimiento(p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r jsonb;
begin
  perform aragon.exigir_admin();
  select jsonb_build_object('email', u.email, 'nombre', c.nombre,
           'datos', coalesce((select s.datos from aragon.seguimiento s where s.user_id = c.user_id), '{}'::jsonb),
           'pase_tipo', p.tipo, 'pase_expira', p.expira) into r
  from aragon.cuentas c join auth.users u on u.id = c.user_id
  left join lateral (select z.tipo, z.expira from aragon.pases z where z.user_id = c.user_id and z.estado = 'activo' order by z.expira desc limit 1) p on true
  where c.user_id = p_user;
  if r is null then return null; end if;
  insert into aragon.admin_log (admin, accion, user_id) values (auth.uid(), 'ver_como', p_user);
  return r;
end;
$$;

-- «Sugerencias y reclamaciones»: todos los mensajes (más recientes primero), con el correo de quien escribe.
create or replace function aragon.admin_mensajes(p_estado text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare filas jsonb;
begin
  perform aragon.exigir_admin();
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'texto', m.texto, 'estado', m.estado, 'respuesta', m.respuesta,
           'creado', m.creado, 'user_id', m.user_id, 'email', u.email) order by m.creado desc), '[]'::jsonb) into filas
  from aragon.mensajes m join auth.users u on u.id = m.user_id
  where p_estado is null or p_estado = '' or m.estado = p_estado;
  return filas;
end;
$$;

-- Marca un mensaje (visto / resuelto) y, si quieres, deja una respuesta que verá la persona en Ajustes.
create or replace function aragon.admin_responder(p_id bigint, p_estado text, p_respuesta text default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform aragon.exigir_admin();
  if p_estado not in ('nuevo', 'visto', 'resuelto') or char_length(coalesce(p_respuesta, '')) > 2000 then return 'invalido'; end if;
  update aragon.mensajes set estado = p_estado, respuesta = coalesce(nullif(btrim(p_respuesta), ''), respuesta),
         respondido = case when nullif(btrim(p_respuesta), '') is not null then now() else respondido end where id = p_id;
  if not found then return 'no_existe'; end if;
  insert into aragon.admin_log (admin, accion, detalle) values (auth.uid(), 'mensaje', p_id::text || ':' || p_estado);
  return 'ok';
end;
$$;

-- Storage: PDF que sube el administrador («Subir PDF»). Bucket privado; el robot semanal los lee con service_role y los borra.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('aragon-pdf', 'aragon-pdf', false, 31457280, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists "aragon-pdf: el administrador ve"   on storage.objects;
    drop policy if exists "aragon-pdf: el administrador sube" on storage.objects;
    drop policy if exists "aragon-pdf: el administrador borra" on storage.objects;
    create policy "aragon-pdf: el administrador ve"    on storage.objects for select to authenticated using (bucket_id = 'aragon-pdf' and aragon.es_admin());
    create policy "aragon-pdf: el administrador sube"  on storage.objects for insert to authenticated with check (bucket_id = 'aragon-pdf' and aragon.es_admin());
    create policy "aragon-pdf: el administrador borra" on storage.objects for delete to authenticated using (bucket_id = 'aragon-pdf' and aragon.es_admin());
  end if;
end $$;

-- Botón "Eliminar mis datos de Aragón" (derecho de supresión): borra el pase, la prueba, el código de invitación, el nombre, los mensajes y el seguimiento de la persona.
-- NO borra el usuario de acceso (auth.users): el proyecto de Supabase se comparte con otras webs (DocentCV) y
-- borrarlo les quitaría también su cuenta.
create or replace function aragon.borrar_mis_datos() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  delete from aragon.seguimiento where user_id = auth.uid();
  delete from aragon.mensajes    where user_id = auth.uid();
  delete from aragon.pases       where user_id = auth.uid();
  delete from aragon.cuentas     where user_id = auth.uid();   -- incluye el nombre; las personas que invitó se quedan sin "referido_por"
end;
$$;

-- Descripciones: se ven en Table Editor (selecciona arriba el esquema "aragon") y dejan claro qué es de esta web.
comment on schema aragon is 'Docentes Aragón: web de adjudicaciones de interinos de Aragón (separado del resto de webs del proyecto)';
comment on table aragon.actos          is 'Una fila por oferta semanal (acto) de Educaragón';
comment on table aragon.cuerpos        is 'Cuerpos docentes (Maestros, Secundaria...)';
comment on table aragon.especialidades is 'Especialidades por cuerpo';
comment on table aragon.localidades    is 'Localidades con coordenadas para el mapa';
comment on table aragon.vacantes       is 'Una fila por vacante ofertada y su estado (ofertada, adjudicada, no adjudicada)';
comment on table aragon.ultimo_llamado is 'Hasta dónde llegó la lista en cada especialidad y semana';
comment on table aragon.keepalive      is 'La toca un robot dos veces por semana para que Supabase no pause el proyecto';
comment on table aragon.pases          is 'Accesos a Mi seguimiento: compra (caduca el 30/06), prueba de 15 días, app gratis por invitaciones o regalo manual. Solo lo escriben las funciones del servidor';
comment on table aragon.cuentas        is 'Quién ha entrado en Docentes Aragón: inicio de la prueba de 15 días, código de invitación, quién la invitó y el nombre que puso para buscar sus listas';
comment on table aragon.seguimiento    is 'Posición en listas y destinos de cada persona. Privado: solo su dueña y solo con pase en vigor';
comment on table aragon.admins         is 'Correos con acceso a la administración de la web';
comment on table aragon.personas       is 'PRIVADA. Candidatos de los listados del curso (nombre normalizado, DNI parcial y posición en cada lista). Solo la leen las funciones buscar_mis_listas y el robot';
comment on table aragon.personas_excluidas is 'PRIVADA. Personas que han pedido no salir en la búsqueda por nombre: cargar_personas las salta y las borra';
comment on table aragon.mensajes       is 'Sugerencias y reclamaciones que envía la gente desde Ajustes';
comment on table aragon.admin_log      is 'Registro de lo que hace el administrador sobre cuentas de otras personas (ver como, regalar pase, corregir nombre...)';

-- ---------------------------------------------------------------------
--  Seguridad (RLS): cualquiera puede LEER las tablas públicas; nadie puede escribir
--  con la clave pública (anon). Solo los robots, con la clave "service_role"
--  (secreta), escriben. Cada persona solo ve sus propias filas.
-- ---------------------------------------------------------------------
alter table aragon.actos          enable row level security;
alter table aragon.cuerpos        enable row level security;
alter table aragon.especialidades enable row level security;
alter table aragon.localidades    enable row level security;
alter table aragon.vacantes       enable row level security;
alter table aragon.ultimo_llamado enable row level security;
alter table aragon.keepalive      enable row level security;   -- sin políticas: nadie lo lee desde la web
alter table aragon.pases          enable row level security;
alter table aragon.seguimiento    enable row level security;
alter table aragon.cuentas        enable row level security;
alter table aragon.admins         enable row level security;   -- sin políticas: solo las funciones del servidor
alter table aragon.personas       enable row level security;   -- sin políticas: solo las funciones del servidor
alter table aragon.personas_excluidas enable row level security;   -- sin políticas: solo el panel de Supabase y el robot
alter table aragon.mensajes       enable row level security;
alter table aragon.admin_log      enable row level security;   -- sin políticas: solo se lee desde el panel de Supabase

do $$
declare t text;
begin
  foreach t in array array['actos','cuerpos','especialidades','localidades','vacantes','ultimo_llamado'] loop
    execute format('drop policy if exists "lectura publica" on aragon.%I', t);
    execute format('create policy "lectura publica" on aragon.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists "mis pases" on aragon.pases;
create policy "mis pases" on aragon.pases for select to authenticated using (user_id = auth.uid());

drop policy if exists "mi cuenta" on aragon.cuentas;
create policy "mi cuenta" on aragon.cuentas for select to authenticated using (user_id = auth.uid());

drop policy if exists "mis mensajes" on aragon.mensajes;
create policy "mis mensajes" on aragon.mensajes for select to authenticated using (user_id = auth.uid());

drop policy if exists "mi seguimiento (leer)"    on aragon.seguimiento;
drop policy if exists "mi seguimiento (crear)"   on aragon.seguimiento;
drop policy if exists "mi seguimiento (cambiar)" on aragon.seguimiento;
drop policy if exists "mi seguimiento (borrar)"  on aragon.seguimiento;
create policy "mi seguimiento (leer)"    on aragon.seguimiento for select to authenticated using (user_id = auth.uid() and aragon.tiene_pase());
create policy "mi seguimiento (crear)"   on aragon.seguimiento for insert to authenticated with check (user_id = auth.uid() and aragon.tiene_pase());
create policy "mi seguimiento (cambiar)" on aragon.seguimiento for update to authenticated using (user_id = auth.uid() and aragon.tiene_pase()) with check (user_id = auth.uid() and aragon.tiene_pase());
create policy "mi seguimiento (borrar)"  on aragon.seguimiento for delete to authenticated using (user_id = auth.uid());

-- Permisos explícitos (un esquema nuevo no hereda los de "public").
grant usage on schema aragon to anon, authenticated, service_role;
grant all on all tables    in schema aragon to service_role;
grant all on all sequences in schema aragon to service_role;
grant all on all functions in schema aragon to service_role;

revoke all on all tables in schema aragon from anon, authenticated;
grant select on aragon.actos, aragon.cuerpos, aragon.especialidades, aragon.localidades, aragon.vacantes, aragon.ultimo_llamado to anon, authenticated;
grant select                         on aragon.pases       to authenticated;
grant select                         on aragon.cuentas     to authenticated;
grant select                         on aragon.mensajes    to authenticated;
grant select, insert, update, delete on aragon.seguimiento to authenticated;

-- Funciones que puede llamar quien ha iniciado sesión (desde la web)...
revoke all on function aragon.tiene_pase(), aragon.es_admin(), aragon.borrar_mis_datos(), aragon.mi_acceso(), aragon.usar_codigo(text), aragon.mi_referidos(),
                       aragon.mi_perfil(), aragon.guardar_nombre(text), aragon.buscar_mis_listas(text), aragon.enviar_mensaje(text, text) from public, anon;
grant execute on function aragon.tiene_pase(), aragon.es_admin(), aragon.borrar_mis_datos(), aragon.mi_acceso(), aragon.usar_codigo(text), aragon.mi_referidos(),
                          aragon.mi_perfil(), aragon.guardar_nombre(text), aragon.buscar_mis_listas(text), aragon.enviar_mensaje(text, text) to authenticated, service_role;
-- ...las de administración (comprueban por dentro que quien llama es administrador)...
revoke all on function aragon.admin_usuarios(text, int, int), aragon.admin_resumen(), aragon.admin_embudo(), aragon.admin_pruebas_terminadas(int),
                       aragon.admin_accion(uuid, text, text), aragon.admin_ver_seguimiento(uuid), aragon.admin_mensajes(text), aragon.admin_responder(bigint, text, text) from public, anon;
grant execute on function aragon.admin_usuarios(text, int, int), aragon.admin_resumen(), aragon.admin_embudo(), aragon.admin_pruebas_terminadas(int),
                          aragon.admin_accion(uuid, text, text), aragon.admin_ver_seguimiento(uuid), aragon.admin_mensajes(text), aragon.admin_responder(bigint, text, text) to authenticated, service_role;
-- ...y las internas, que solo usan otras funciones o el servidor.
revoke all on function aragon.curso_de(date), aragon.nuevo_codigo(), aragon.asegurar_cuenta(uuid), aragon.aplicar_codigo(uuid, text),
                       aragon.invitados_que_pagaron(uuid, text), aragon.premiar_invitaciones(), aragon.clave_nombre(text), aragon.fijar_nombre(uuid, text, boolean),
                       aragon.cargar_personas(text, jsonb), aragon.exigir_admin() from public, anon, authenticated;
grant execute on function aragon.curso_de(date), aragon.nuevo_codigo(), aragon.asegurar_cuenta(uuid), aragon.aplicar_codigo(uuid, text),
                          aragon.invitados_que_pagaron(uuid, text), aragon.premiar_invitaciones(), aragon.clave_nombre(text), aragon.fijar_nombre(uuid, text, boolean),
                          aragon.cargar_personas(text, jsonb), aragon.exigir_admin() to service_role;
