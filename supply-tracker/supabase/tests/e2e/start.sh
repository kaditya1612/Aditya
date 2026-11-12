#!/usr/bin/env bash
# Boots: fresh DB (migrations + e2e seed) → emulator on :54321 → production build of the app on :3100
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=supply_e2e
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/e2e/setup.sql
echo "database ready"
