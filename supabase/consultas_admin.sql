-- =====================================================================
--  Docentes Aragón · consultas para ti (administrador)
--  Cómo se usan: Supabase > SQL Editor > New query > pega SOLO UN bloque (los separa una línea de «=====») > Run.
--  Los bloques 1 a 5, 10 y 11 solo MIRAN datos: se pueden ejecutar sin miedo.
--  Los bloques 6 a 9 CAMBIAN datos: cambia el correo de ejemplo (correo@ejemplo.com) por el de la persona antes de ejecutarlos.
--  Aquí verás correos de personas: son datos personales, no los compartas ni los pegues en sitios públicos.
-- =====================================================================


-- =====================================================================
-- 1. Resumen: cuánta gente hay y cómo va
-- =====================================================================
select
  (select count(*) from aragon.cuentas)                                                                   as personas_que_han_entrado,
  (select count(distinct user_id) from aragon.pases where tipo = 'prueba' and estado = 'activo' and expira >= current_date) as en_prueba_ahora,
  (select count(distinct user_id) from aragon.pases where tipo in ('suscripcion', 'pago_unico') and estado = 'activo' and curso = aragon.curso_de()) as han_pagado_este_curso,
  (select count(*) from aragon.pases where tipo = 'invitaciones' and curso = aragon.curso_de())           as app_gratis_por_invitar,
  (select count(*) from aragon.pases where tipo = 'manual' and estado = 'activo' and expira >= current_date) as regalos_manuales;


-- =====================================================================
-- 2. Quién ha pagado (lo más reciente primero)
-- =====================================================================
select u.email, p.curso, p.tipo, p.expira as acceso_hasta, p.estado, p.creado::date as fecha_de_compra
from aragon.pases p join auth.users u on u.id = p.user_id
where p.tipo in ('suscripcion', 'pago_unico')
order by p.creado desc;


-- =====================================================================
-- 3. Pruebas gratuitas en marcha, de la que acaba antes a la que acaba después
-- =====================================================================
select u.email, p.expira as ultimo_dia_de_prueba, (p.expira - current_date + 1) as dias_que_le_quedan
from aragon.pases p join auth.users u on u.id = p.user_id
where p.tipo = 'prueba' and p.estado = 'activo' and p.expira >= current_date
order by p.expira;


-- =====================================================================
-- 4. Personas sin acceso ahora mismo (prueba acabada y sin pagar): para un recordatorio o para saber cuántas pierdes
-- =====================================================================
select u.email, c.alta::date as primera_entrada
from aragon.cuentas c join auth.users u on u.id = c.user_id
where not exists (select 1 from aragon.pases p where p.user_id = c.user_id and p.estado = 'activo' and p.expira >= current_date)
order by c.alta desc;


-- =====================================================================
-- 5. Invitaciones: quién ha invitado a cuántas personas y cuántas han pagado este curso (3 pagadas = app gratis)
-- =====================================================================
select inv.email as quien_invita, c.codigo, count(*) as invitados,
       count(*) filter (where exists (select 1 from aragon.pases p where p.user_id = x.user_id and p.tipo in ('suscripcion', 'pago_unico')
                                       and p.estado = 'activo' and p.curso = aragon.curso_de())) as han_pagado
from aragon.cuentas x
join aragon.cuentas c   on c.user_id = x.referido_por
join auth.users     inv on inv.id = c.user_id
group by inv.email, c.codigo
order by invitados desc;


-- =====================================================================
-- 6. REGALAR el curso a alguien (hasta el 30/06). La persona tiene que haberse registrado antes.
-- =====================================================================
insert into aragon.pases (user_id, curso, producto, tipo, expira)
select id, aragon.curso_de(), 'regalo', 'manual', make_date(2000 + right(aragon.curso_de(), 2)::int, 6, 30)
from auth.users where email = 'correo@ejemplo.com';
-- Debe decir «INSERT 0 1». Si dice «INSERT 0 0», ese correo no existe: la persona aún no se ha registrado.


-- =====================================================================
-- 7. ALARGAR la prueba gratuita de alguien 7 días más (cambia el 7 por los días que quieras)
-- =====================================================================
update aragon.pases set expira = expira + 7
where tipo = 'prueba' and user_id = (select id from auth.users where email = 'correo@ejemplo.com');
-- Debe decir «UPDATE 1». Si la prueba ya había acabado y quieres darle días desde hoy, usa:  set expira = current_date + 7


-- =====================================================================
-- 8. ANULAR un pase (por ejemplo, tras un reembolso de Google Play). La persona pierde el acceso; sus datos se conservan.
-- =====================================================================
update aragon.pases set estado = 'anulado'
where tipo in ('suscripcion', 'pago_unico') and user_id = (select id from auth.users where email = 'correo@ejemplo.com');
-- Para volver a darle acceso:  set estado = 'activo'


-- =====================================================================
-- 9. BORRAR a una persona de Docentes Aragón (a petición suya): pase, prueba, código de invitación y seguimiento.
--    No borra su cuenta de acceso (correo y contraseña), porque es la misma que usa DocentsCV.
--    Ejecútalo entero (los cuatro «delete» a la vez). No se puede deshacer.
-- =====================================================================
delete from aragon.seguimiento where user_id = (select id from auth.users where email = 'correo@ejemplo.com');
delete from aragon.pases       where user_id = (select id from auth.users where email = 'correo@ejemplo.com');
delete from aragon.cuentas     where user_id = (select id from auth.users where email = 'correo@ejemplo.com');


-- =====================================================================
-- 10. Cuánto has ingresado este curso (cálculo aproximado con 7,49 €; Google se queda su comisión y el IVA va aparte)
-- =====================================================================
select count(*) as pases_pagados,
       round(count(*) * 7.49, 2)        as cobrado_con_iva,
       round(count(*) * 7.49 / 1.21, 2) as base_sin_iva
from aragon.pases
where tipo in ('suscripcion', 'pago_unico') and estado = 'activo' and curso = aragon.curso_de();


-- =====================================================================
-- 11. Espacio que ocupa la base de datos (el plan gratuito de Supabase da 500 MB para TODAS las webs del proyecto)
-- =====================================================================
select pg_size_pretty(pg_database_size(current_database())) as total_del_proyecto,
       (select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'aragon' and c.relkind = 'r') as solo_docentes_aragon;
