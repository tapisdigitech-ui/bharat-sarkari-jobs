#!/usr/bin/env bash
# Local Postgres for tests. Usage: tests/harness/pg.sh start|reset|stop
set -euo pipefail
if [ "$(id -u)" = 0 ]; then DEF=/home/claude/.pgtest; else DEF="$HOME/.pgtest"; fi; DIR="${PGTEST_DIR:-$DEF}"; PORT="${PGTEST_PORT:-5544}"; BIN="$(brew --prefix postgresql@16)/bin"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
as_pg() { if [ "$(id -u)" = 0 ]; then su claude -c "$*"; else bash -c "$*"; fi; }
psqlc() { psql -h "$DIR" -p "$PORT" -U claude -v ON_ERROR_STOP=1 -q "$@"; }
case "${1:-}" in
  start)
    mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown claude "$DIR"
    [ -d "$DIR/data" ] || as_pg "$BIN/initdb -D $DIR/data -A trust >/dev/null"
    as_pg "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1' -l $DIR/log -w start >/dev/null" || true ;;
  reset)
    # Real Supabase runs migrations as role "postgres"; mirror that so SECURITY DEFINER owners and trusted-role checks behave the same.
    psql -h "$DIR" -p "$PORT" -U claude postgres -q -c "do \$\$ begin if not exists (select from pg_roles where rolname='postgres') then create role postgres superuser login; end if; end \$\$"
    psql -h "$DIR" -p "$PORT" -U claude postgres -q -c "drop database if exists app_test with (force)" -c "create database app_test owner postgres"
    export PGDATABASE=app_test
    psqlp() { psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
    psqlp -f "$ROOT/tests/harness/bootstrap.sql"
    for f in "$ROOT"/supabase/migrations/*.sql; do echo "-- applying $(basename "$f")"; psqlp -f "$f"; done ;;
  stop) as_pg "$BIN/pg_ctl -D $DIR/data stop -m fast >/dev/null" || true ;;
  *) echo "usage: $0 start|reset|stop"; exit 1 ;;
esac
