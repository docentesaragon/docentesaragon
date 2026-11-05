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

-- ¿Tiene la persona que hace la consulta un pase en vigor?
create or replace function aragon.tiene_pase() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
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

-- La web la llama cada vez que alguien entra: crea la cuenta y la prueba la primera vez, y aplica el código de
-- invitación con el que se registró (viene en los datos de la cuenta, user_metadata.codigo_invitacion_aragon).
create or replace function aragon.mi_acceso() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare yo uuid := auth.uid(); nueva boolean; cod text; resultado text := null;
begin
  if yo is null then raise exception 'No has iniciado sesión'; end if;
  nueva := aragon.asegurar_cuenta(yo);
  if nueva then
    cod := nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'codigo_invitacion_aragon', '')), '');
    if cod is not null then resultado := aragon.aplicar_codigo(yo, cod); end if;
  end if;
  return jsonb_build_object('nueva', nueva, 'codigo_invitacion', resultado);
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

-- Botón "Borrar mis datos de Docentes Aragón" (derecho de supresión): borra el pase, la prueba, el código de invitación y el seguimiento de la persona.
-- NO borra el usuario de acceso (auth.users): el proyecto de Supabase se comparte con otras webs (DocentCV) y
-- borrarlo les quitaría también su cuenta.
create or replace function aragon.borrar_mis_datos() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'No has iniciado sesión'; end if;
  delete from aragon.seguimiento where user_id = auth.uid();
  delete from aragon.pases       where user_id = auth.uid();
  delete from aragon.cuentas     where user_id = auth.uid();   -- las personas que invitó se quedan sin "referido_por"
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
comment on table aragon.cuentas        is 'Quién ha entrado en Docentes Aragón: inicio de la prueba de 15 días, código de invitación y quién la invitó';
comment on table aragon.seguimiento    is 'Posición en listas y destinos de cada persona. Privado: solo su dueña y solo con pase en vigor';

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
grant select, insert, update, delete on aragon.seguimiento to authenticated;

-- Funciones que puede llamar quien ha iniciado sesión (desde la web)...
revoke all on function aragon.tiene_pase(), aragon.borrar_mis_datos(), aragon.mi_acceso(), aragon.usar_codigo(text), aragon.mi_referidos() from public, anon;
grant execute on function aragon.tiene_pase(), aragon.borrar_mis_datos(), aragon.mi_acceso(), aragon.usar_codigo(text), aragon.mi_referidos() to authenticated, service_role;
-- ...y las internas, que solo usan otras funciones o el servidor.
revoke all on function aragon.curso_de(date), aragon.nuevo_codigo(), aragon.asegurar_cuenta(uuid), aragon.aplicar_codigo(uuid, text),
                       aragon.invitados_que_pagaron(uuid, text), aragon.premiar_invitaciones() from public, anon, authenticated;
grant execute on function aragon.curso_de(date), aragon.nuevo_codigo(), aragon.asegurar_cuenta(uuid), aragon.aplicar_codigo(uuid, text),
                          aragon.invitados_que_pagaron(uuid, text), aragon.premiar_invitaciones() to service_role;
