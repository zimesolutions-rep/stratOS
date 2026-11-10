#!/usr/bin/env bash
# Usage: PGHOST=... PGPORT=... PGUSER=postgres db/tests/run.sh
# Creates a scratch database, applies the migrations, then runs the StratOS checks.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=stratos_rls_test
psql -qd postgres -c "drop database if exists $DB" -c "create database $DB"
for f in migrations/*.sql tests/stratos_rls_test.sql; do
  echo "== $f"
  psql -qd $DB -v ON_ERROR_STOP=1 -o /dev/null -f "$f"
done
