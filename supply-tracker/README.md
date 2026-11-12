# Supply Team Portal

Task management and productivity tracker built **only for the Supply Team** — tasks, incoming requirements,
costing validation, deadlines, workload and management reporting in one place.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, Storage, pg_cron) · Vercel

- Architecture, database design, wireframes and phase plan → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Production deployment, backups and security checklist → [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## What's inside

| Module | Highlights |
|---|---|
| **Dashboard** | 10 live KPI cards, filters (date range, employee, category, priority, status, assigned by, type), 10 interactive charts, click-through drill-down to task records, escalation / approval / extension queues |
| **All Tasks** | Searchable, sortable, filterable tracker; CSV/Excel export; auto IDs (`TSK-000001`); one accountable owner + team members |
| **Task detail** | Typed activity log (remarks, progress, blockers, supplier responses, delay reasons, completion notes), immutable status history, documents, extension requests, approvals |
| **Daily Task Allocation** | Per-employee active / new / due-today / critical / overdue / completed counts, workload indicator (Low → Overloaded), one-click redistribution, daily closure report (Excel/PDF) |
| **Supply Requirements** | Intake from Sales / Operations / Management (as data, not users); New → Under Review → Accepted/Rejected/Clarification → Assigned → In Progress → Completed → Closed; mandatory rejection reason; pending-days tracking; delay analysis by department |
| **Costing & Validation** | Tour/supplier cost validation, margin & change %, per-person/car/group, private/SIC, seasonal; approval impossible without a supplier confirmation reference; approved records locked, revisions supersede; full change history. Never writes to production pricing |
| **Product / Vendor Management** | Category-group workspaces; supplier & DMC directory; pending supplier responses |
| **Kanban** | Drag-and-drop across 9 columns; every move goes through the workflow and history |
| **Employee Productivity** | Directory (add / edit / deactivate) and multi-factor productivity (priority × effort × timeliness × quality × reopens), period-over-period and month-wise comparison |
| **Reports** | 14 reports with date & employee filters, CSV / Excel / PDF export |
| **Audit History** | Append-only trail of creation, assignment, reassignment, priority/deadline/status changes, costing validation, approvals, rejections, closure, reopening, escalation |
| **Notifications** | In-app (live) for assignment, reassignment, upcoming / due-shortly / overdue deadlines, critical escalation, supplier responses, completions, approval requests; optional email digests for management |
| **Settings** | Users & roles, task categories, teams & departments, workload/scoring rules, recurring tasks, email preferences |

**Roles:** Administrator · Supply Team Manager · Supply Team Leader (team-scoped). Employees are task owners
without logins. Sales / Operations have no access.

## Local development

```bash
cp .env.example .env.local   # fill in your Supabase project URL + keys
```

```bash
npm install
```

```bash
npm run dev
```

## Tests

| Command | What it verifies |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests: KPI maths, productivity weighting, workload, time series, export escaping |
| `npm run test:db` | 86 database tests on a real Postgres: RLS isolation between teams, anonymous denial, workflow guards (no silent deadline/status changes, approval-only completion, mandatory reasons), requirement & costing workflows, deadline monitor & escalation, recurring tasks, append-only history & audit |
| `npm run test:e2e` | 48 browser checks (Playwright/Chromium) driving the production build: login, employees, task lifecycle, rejection/approval, requirements, costing approval + document upload, leader restrictions, extension approval, Kanban drag-and-drop, allocation, dashboard drill-down, report exports, audit, dark mode, mobile |

`test:db` and `test:e2e` need a local Postgres 15+ (set `PGHOST`, `PGPORT`, `PGUSER`). The E2E suite runs the
app against `supabase/tests/e2e/emulator.mjs`, a **test-only** stand-in for Supabase's REST/Auth/Storage APIs that
executes every request as the `authenticated` Postgres role, so RLS and triggers are exercised for real.
CI runs all four on every push (`.github/workflows/supply-portal.yml`).

## Project layout

```
supabase/migrations/   schema · workflow functions · RLS & views · reference data · storage & cron
supabase/tests/        SQL test suite + E2E (emulator, seed, Playwright scenario)
src/app/(app)/         authenticated pages (dashboard, tasks, allocation, requirements, costing, …)
src/app/api/           admin user management, scheduled monitor / email dispatch
src/components/        UI kit, task components, charts, attachments
src/lib/               Supabase clients, data hooks, metrics, validation, exports
```
