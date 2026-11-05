-- Prueba de permisos (RLS) de supabase/schema.sql con usuarios simulados.
-- Necesita una PostgreSQL vacía con el "stub" de Supabase (roles anon/authenticated/service_role, esquema auth y auth.uid()).
-- Cada línea "ESPERADO: ..." dice qué debe salir justo debajo.
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001','ana@x'), ('bbbbbbbb-0000-0000-0000-000000000002','beto@x');
insert into aragon.actos (acto,cuerpo,fecha_oferta,curso) values ('PRI-2026-1','maestros','2026-09-01','2026-27');
insert into aragon.pases (user_id,curso,producto,tipo,token,expira) values
 ('aaaaaaaa-0000-0000-0000-000000000001','2026-27','pase_2026_27','suscripcion','tok-ana', current_date + 30),
 ('bbbbbbbb-0000-0000-0000-000000000002','2025-26','pase_2025_26','suscripcion','tok-beto', current_date - 1);

\echo '== 1. anon: lee actos (1); NO ve pases, seguimiento ni funciones; NO escribe  [ESPERADO: 1 fila y 4 "permission denied"]'
set role anon;
select 'anon actos: ' || count(*) from aragon.actos;
select count(*) from aragon.pases;
insert into aragon.actos (acto,cuerpo,fecha_oferta,curso) values ('X','m','2026-01-01','c');
select count(*) from aragon.seguimiento;
select aragon.tiene_pase();
reset role;

\echo '== 2. Ana (pase vigente)  [ESPERADO: true, 1 pase, lee y actualiza lo suyo; falla: escribir como Beto, crearse pases, alargar pase, JSON enorme]'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'Ana tiene_pase: ' || aragon.tiene_pase();
select 'Ana ve sus pases: ' || count(*) from aragon.pases;
insert into aragon.seguimiento (user_id, datos) values ('aaaaaaaa-0000-0000-0000-000000000001', '{"listas":[1]}');
select 'Ana lee su seguimiento: ' || datos::text from aragon.seguimiento;
update aragon.seguimiento set datos = '{"listas":[1,2]}' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'Ana tras update: ' || datos::text from aragon.seguimiento;
\echo '-- como Beto (debe fallar):'
insert into aragon.seguimiento (user_id, datos) values ('bbbbbbbb-0000-0000-0000-000000000002', '{}');
\echo '-- crearse un pase / alargarlo (debe fallar):'
insert into aragon.pases (user_id,curso,producto,tipo,expira) values ('aaaaaaaa-0000-0000-0000-000000000001','2026-27','p','manual','2030-01-01');
update aragon.pases set expira = '2099-01-01';
\echo '-- JSON enorme (debe fallar):'
update aragon.seguimiento set datos = jsonb_build_object('x', repeat('a', 200000));
reset role;

\echo '== 3. Beto (pase caducado)  [ESPERADO: false, 0 filas de seguimiento, no puede escribir, ve solo su pase]'
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select 'Beto tiene_pase: ' || aragon.tiene_pase();
select 'Beto ve seguimiento: ' || count(*) from aragon.seguimiento;
insert into aragon.seguimiento (user_id, datos) values ('bbbbbbbb-0000-0000-0000-000000000002', '{}');
select 'Beto ve sus pases (solo el suyo): ' || count(*) from aragon.pases;
reset role;

\echo '== 4. Ana borra sus datos  [ESPERADO: usuarios 2 (el usuario compartido se queda), pases 1 (el de Beto), seguimiento 0]'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select aragon.borrar_mis_datos();
reset role;
select 'usuarios: ' || count(*) from auth.users;
select 'pases restantes: ' || count(*) from aragon.pases;
select 'seguimiento restante: ' || count(*) from aragon.seguimiento;

\echo '== 5. anon no puede borrar datos  [ESPERADO: permission denied]'
set role anon; select aragon.borrar_mis_datos(); reset role;

\echo '== 6. service_role escribe en todo; tras renovar, Beto vuelve a tener pase  [ESPERADO: service ok, true]'
set role service_role;
insert into aragon.pases (user_id,curso,producto,tipo,token,expira) values ('bbbbbbbb-0000-0000-0000-000000000002','2026-27','pase_2026_27','suscripcion','tok-beto2', '2027-06-30');
insert into aragon.keepalive (id) values (1) on conflict (id) do update set ultimo_ping = now();
select 'service ok';
reset role;
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false) is not null;
set role authenticated; select aragon.tiene_pase(); reset role;

\echo '== 7. descripciones para el panel  [ESPERADO: 10 tablas con descripción]'
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'aragon' and c.relkind = 'r' and obj_description(c.oid) is not null;

-- =====================================================================
--  Prueba gratuita de 15 días e invitaciones
-- =====================================================================
insert into auth.users values
 ('cccccccc-0000-0000-0000-000000000003','carla@x'), ('dddddddd-0000-0000-0000-000000000004','dani@x'),
 ('eeeeeeee-0000-0000-0000-000000000005','eva@x'),   ('ffffffff-0000-0000-0000-000000000006','fer@x'),
 ('99999999-0000-0000-0000-000000000007','gus@x'),   ('88888888-0000-0000-0000-000000000008','hugo@x');

\echo '== 8. Carla entra por primera vez  [ESPERADO: nueva=true, luego false; 1 pase de prueba con 15 días; tiene_pase true; código con formato ARA-XXXXX; puede guardar su seguimiento; NO puede crear cuentas ni cambiar su código]'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'Carla 1a vez nueva=' || (aragon.mi_acceso()->>'nueva');
select 'Carla 2a vez nueva=' || (aragon.mi_acceso()->>'nueva');
select 'Carla pases=' || count(*) || ' tipo=' || min(tipo) || ' dias=' || (min(expira) - current_date + 1) from aragon.pases;
select 'Carla tiene_pase=' || aragon.tiene_pase();
select 'Carla codigo con formato: ' || (codigo ~ '^ARA-[A-HJ-NP-Z2-9]{5}$') from aragon.cuentas;
insert into aragon.seguimiento (user_id, datos) values ('cccccccc-0000-0000-0000-000000000003', '{"listas":[]}');
insert into aragon.cuentas (user_id, codigo) values ('dddddddd-0000-0000-0000-000000000004', 'ARA-HACKS');
update aragon.cuentas set codigo = 'ARA-22222';
reset role;
select 'cuentas=' || count(*) from aragon.cuentas;

\echo '== 9. Códigos de invitación  [ESPERADO: ok, ya_usado, propio, no_existe, circular, caducado, ok (mayúsculas/minúsculas da igual)]'
select codigo as cod_carla from aragon.cuentas where user_id = 'cccccccc-0000-0000-0000-000000000003' \gset
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004';
select 'Dani usa el codigo de Carla (en minusculas): ' || aragon.usar_codigo(lower(:'cod_carla'));
select 'Dani lo repite: ' || aragon.usar_codigo(:'cod_carla');
select codigo as cod_dani from aragon.cuentas \gset
reset role;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'Carla usa el suyo: ' || aragon.usar_codigo(:'cod_carla');
select 'Carla usa uno inventado: ' || aragon.usar_codigo('ARA-NOEXI');
select 'Carla usa el de Dani (Dani la usó a ella): ' || aragon.usar_codigo(:'cod_dani');
reset role;
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000005';
select 'Eva entra: ' || (aragon.mi_acceso()->>'nueva');
reset role;
update aragon.cuentas set alta = now() - interval '31 days' where user_id = 'eeeeeeee-0000-0000-0000-000000000005';
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000005';
select 'Eva (31 dias despues) usa el de Carla: ' || aragon.usar_codigo(:'cod_carla');
select 'Eva puede_usar: ' || (aragon.mi_referidos()->>'puede_usar');
reset role;
update aragon.cuentas set alta = now() where user_id = 'eeeeeeee-0000-0000-0000-000000000005';
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000005';
select 'Eva (dentro de plazo) usa el de Carla: ' || aragon.usar_codigo(:'cod_carla');
reset role;

\echo '== 10. Invitar y ganar  [ESPERADO: invitados 3; pagados 0, 1 (Dani), 1 (un pase de otro curso no cuenta), 2, 3 con gratis=true; Carla tiene prueba + invitaciones; un cuarto pago no duplica]'
set role authenticated; set request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000000006';
select 'Fer entra: ' || (aragon.mi_acceso()->>'nueva') || ' y usa el codigo: ' || aragon.usar_codigo(:'cod_carla');
reset role;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'Carla invitados=' || (aragon.mi_referidos()->>'invitados') || ' pagados=' || (aragon.mi_referidos()->>'pagados') || ' gratis=' || (aragon.mi_referidos()->>'gratis');
reset role;
set role service_role;
insert into aragon.pases (user_id,curso,producto,tipo,token,expira) values ('dddddddd-0000-0000-0000-000000000004', aragon.curso_de(), 'pase', 'pago_unico', 'tok-dani', current_date + 100);
reset role;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'tras pagar Dani: pagados=' || (aragon.mi_referidos()->>'pagados') || ' gratis=' || (aragon.mi_referidos()->>'gratis');
reset role;
set role service_role;
insert into aragon.pases (user_id,curso,producto,tipo,token,expira) values ('eeeeeeee-0000-0000-0000-000000000005','2020-21','pase','pago_unico','tok-eva-vieja','2021-06-30');
reset role;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'tras pase viejo de Eva (otro curso): pagados=' || (aragon.mi_referidos()->>'pagados');
reset role;
set role service_role;
insert into aragon.pases (user_id,curso,producto,tipo,token,expira) values ('eeeeeeee-0000-0000-0000-000000000005', aragon.curso_de(), 'pase', 'pago_unico', 'tok-eva', current_date + 100);
reset role;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'tras pagar Eva: pagados=' || (aragon.mi_referidos()->>'pagados') || ' gratis=' || (aragon.mi_referidos()->>'gratis');
reset role;
set role service_role;
insert into aragon.pases (user_id,curso,producto,tipo,token,expira) values ('ffffffff-0000-0000-0000-000000000006', aragon.curso_de(), 'pase', 'pago_unico', 'tok-fer', current_date + 100);
reset role;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'tras pagar Fer: pagados=' || (aragon.mi_referidos()->>'pagados') || ' gratis=' || (aragon.mi_referidos()->>'gratis');
select 'pases de Carla: ' || string_agg(tipo, ',' order by tipo) from aragon.pases;
reset role;
set role service_role;
insert into aragon.pases (user_id,curso,producto,tipo,token,expira) values ('88888888-0000-0000-0000-000000000008', aragon.curso_de(), 'pase', 'pago_unico', 'tok-hugo-sin-invitador', current_date + 100);
reset role;
select 'pases invitaciones de Carla (no se duplican): ' || count(*) from aragon.pases where tipo = 'invitaciones';

\echo '== 11. Código traído al crear la cuenta (user_metadata)  [ESPERADO: Hugo -> codigo_invitacion ok y a Carla le sube a 4 invitados; Gus con código inventado -> no_existe pero con cuenta y prueba (tiene_pase true)]'
set role authenticated; set request.jwt.claim.sub = '88888888-0000-0000-0000-000000000008';
select set_config('request.jwt.claims', jsonb_build_object('user_metadata', jsonb_build_object('codigo_invitacion_aragon', :'cod_carla'))::text, false) is not null;
select 'Hugo: ' || (aragon.mi_acceso())::text;
reset role;
set role authenticated; set request.jwt.claim.sub = '99999999-0000-0000-0000-000000000007';
select set_config('request.jwt.claims', '{"user_metadata":{"codigo_invitacion_aragon":"ARA-MALO1"}}', false) is not null;
select 'Gus: ' || (aragon.mi_acceso())::text;
select 'Gus tiene_pase=' || aragon.tiene_pase();
reset role;
select set_config('request.jwt.claims', '', false) is not null;
select 'Carla invitados: ' || count(*) from aragon.cuentas where referido_por = 'cccccccc-0000-0000-0000-000000000003';

\echo '== 12. Prueba caducada  [ESPERADO: con la prueba caducada y su pago anulado Dani no tiene pase; al volver a entrar no se le crea otra prueba; no se puede insertar una segunda]'
update aragon.pases set expira = current_date - 1 where user_id = 'dddddddd-0000-0000-0000-000000000004' and tipo = 'prueba';
update aragon.pases set estado = 'anulado' where user_id = 'dddddddd-0000-0000-0000-000000000004' and tipo = 'pago_unico';
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004';
select 'Dani tiene_pase=' || aragon.tiene_pase();
select 'Dani vuelve a entrar nueva=' || (aragon.mi_acceso()->>'nueva');
select 'Dani tiene_pase=' || aragon.tiene_pase() || ' pases de prueba=' || (select count(*) from aragon.pases where tipo = 'prueba');
reset role;
insert into aragon.pases (user_id,curso,producto,tipo,expira) values ('dddddddd-0000-0000-0000-000000000004', aragon.curso_de(), 'prueba', 'prueba', current_date + 14);

\echo '== 13. Funciones internas cerradas  [ESPERADO: 6 "permission denied" (anon: mi_acceso y mi_referidos; authenticated: asegurar_cuenta, aplicar_codigo, invitados_que_pagaron, premiar_invitaciones)]'
set role anon;
select aragon.mi_acceso();
select aragon.mi_referidos();
reset role;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select aragon.asegurar_cuenta('dddddddd-0000-0000-0000-000000000004');
select aragon.aplicar_codigo('cccccccc-0000-0000-0000-000000000003', 'ARA-AAAAA');
select aragon.invitados_que_pagaron('cccccccc-0000-0000-0000-000000000003', '2026-27');
select aragon.premiar_invitaciones();
reset role;

\echo '== 14. Carla borra sus datos  [ESPERADO: sin cuenta ni pases ni seguimiento; Dani, Eva y Fer siguen con cuenta pero sin invitador; al volver a entrar tiene una prueba nueva]'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select aragon.borrar_mis_datos();
reset role;
select 'cuenta de Carla: ' || count(*) from aragon.cuentas where user_id = 'cccccccc-0000-0000-0000-000000000003';
select 'pases de Carla: ' || count(*) from aragon.pases where user_id = 'cccccccc-0000-0000-0000-000000000003';
select 'invitados que quedan con invitador: ' || count(*) from aragon.cuentas where referido_por is not null;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'Carla vuelve: nueva=' || (aragon.mi_acceso()->>'nueva');
select 'Carla tiene_pase=' || aragon.tiene_pase();
reset role;

\echo '== 15. curso_de y fin de curso  [ESPERADO: 2026-27, 2026-27, 2026-27, 2027-28]'
select aragon.curso_de('2026-07-01'), aragon.curso_de('2026-11-05'), aragon.curso_de('2027-06-30'), aragon.curso_de('2027-07-01');
