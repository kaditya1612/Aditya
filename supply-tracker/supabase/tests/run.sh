#!/usr/bin/env bash
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
# Recreates a scratch database, applies the stub + all migrations, then runs the test suite.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-supply_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "→ applying $f"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
echo "→ running tests"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/10_workflow_tests.sql
