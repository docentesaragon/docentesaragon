#!/bin/bash
# Prueba los permisos y las funciones de supabase/schema.sql en una PostgreSQL temporal (solo para quien programa; no hace falta para publicar).
# Uso (Linux, con PostgreSQL instalado):  bash pruebas/rls.sh            -> imprime la salida de pruebas/rls.sql
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"; RAIZ="$(dirname "$AQUI")"
BIN="$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
DIR=/var/tmp/pgtest; rm -rf "$DIR"; mkdir -p "$DIR"; chown postgres "$DIR"
su postgres -c "$BIN/initdb -D $DIR/data -A trust >/dev/null && $BIN/pg_ctl -D $DIR/data -o '-p 54555 -k $DIR' -l $DIR/log -w start >/dev/null"
trap 'su postgres -c "$BIN/pg_ctl -D $DIR/data -m fast stop >/dev/null"; rm -rf "$DIR"' EXIT
PSQL="psql -h $DIR -p 54555 -U postgres -v ON_ERROR_STOP=1 -q"
cp "$RAIZ/supabase/schema.sql" "$AQUI/stub_supabase.sql" "$AQUI/rls.sql" "$DIR/"; chmod a+r "$DIR"/*.sql
su postgres -c "$PSQL -f $DIR/stub_supabase.sql postgres"
su postgres -c "$PSQL -f $DIR/schema.sql postgres"
echo '--- segunda ejecución de schema.sql (debe ser idempotente) ---'
su postgres -c "$PSQL -f $DIR/schema.sql postgres" && echo 'idempotente: OK'
su postgres -c "psql -h $DIR -p 54555 -U postgres -f $DIR/rls.sql postgres" 2>&1
echo '--- consultas de administración (supabase/consultas_admin.sql): no debe salir ningún ERROR ---'
cp "$RAIZ/supabase/consultas_admin.sql" "$DIR/"; chmod a+r "$DIR/consultas_admin.sql"
su postgres -c "psql -h $DIR -p 54555 -U postgres -v ON_ERROR_STOP=1 -q -f $DIR/consultas_admin.sql postgres" 2>&1 | tail -40
echo 'consultas de administración: terminadas'

