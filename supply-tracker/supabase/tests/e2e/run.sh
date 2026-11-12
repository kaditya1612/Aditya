#!/usr/bin/env bash
# Full end-to-end run: fresh DB → emulator → production build → Playwright scenario.
# Requires a local Postgres 15+ (PGHOST/PGPORT/PGUSER env) and Playwright's Chromium.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export SERVICE_KEY=e2e-service-key CRON_SECRET=e2e-cron-secret
export DATABASE_URL="postgresql://${PGUSER:-postgres}@/supply_e2e?host=${PGHOST:-/var/run/postgresql}&port=${PGPORT:-5432}"
bash supabase/tests/e2e/start.sh
node supabase/tests/e2e/emulator.mjs > /tmp/supply-emulator.log 2>&1 & EMU=$!
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
NEXT_TELEMETRY_DISABLED=1 npx next build > /tmp/supply-build.log 2>&1
PORT=3100 npx next start > /tmp/supply-next.log 2>&1 & APP=$!
trap 'kill $EMU $APP 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/login && break; sleep 1; done
BASE=http://localhost:3100 SHOTS=${SHOTS:-/tmp/supply-e2e} node supabase/tests/e2e/app.e2e.mjs
