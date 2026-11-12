# Supply Team Portal — Architecture, Wireframes & Development Plan

Scope: a portal **only for the Supply Team**. Sales, Operations and Management appear as
*requesting departments* (data), never as users. Employees are task owners (records), not
logins. Only three roles sign in: **Administrator**, **Supply Team Manager**, **Supply Team Leader**.

---

## 1. System architecture

```
 Browser (desktop / mobile)
   │  Next.js 15 App Router · React 19 · TypeScript · Tailwind v4
   │  - Client pages call Supabase directly with the user's JWT → RLS enforced in Postgres
   │  - Workflow actions call Postgres RPC functions (validated server-side)
   ▼
 Vercel
   ├─ middleware.ts         session refresh + route protection
   ├─ /api/admin/users      admin-only user creation / deactivation (service-role key, server only)
   └─ /api/cron/monitor     deadline monitor + recurring tasks + email dispatch (CRON_SECRET)
   ▼
 Supabase
   ├─ Auth                  email/password, public sign-up disabled, role kept in app_metadata
   ├─ Postgres              tables · enums · triggers · RPC · RLS · audit log · views
   ├─ Storage               private bucket `supply-attachments` (RLS on storage.objects)
   └─ pg_cron               runs run_deadline_monitor() every 15 min, recurring tasks daily
```

**Where the rules live.** Every business rule that matters for control is enforced in the
database, not just the UI, so it cannot be bypassed with a crafted API call:

| Rule | Enforcement |
|---|---|
| Status changes only through the workflow, always logged with remarks | `BEFORE UPDATE` guard on `tasks.status` + `change_task_status()` RPC + history trigger |
| Completion needs manager approval | `decide_task_approval()` is manager/admin-only; nothing else can set `completed` |
| No silent deadline changes | guard on `tasks.due_at`; only `request_deadline_extension()` / `decide_deadline_extension()` can move it; original deadline is immutable; extension count kept |
| Rejecting a requirement needs a reason; clarification must be documented | `transition_requirement()` raises if remarks are empty |
| No requirement assigned without an owner | `CHECK` constraint + RPC validation |
| Costing approval needs a confirmation reference; approved costing is locked | `decide_costing()` + lock trigger; revisions create a new record that supersedes the old one |
| History cannot be erased | no `UPDATE`/`DELETE` policies on history, comments or audit tables for anyone |
| Leaders see only their team | RLS helper `can_access_employee()` / `can_access_task()` |

The portal **records** the costing validation workflow. It never writes to the company's
production pricing database.

---

## 2. Database architecture

### Entity relationship (simplified)

```
auth.users 1─1 profiles ──┐ (role: admin | manager | leader, team_id)
                          │
teams 1─* employees ──────┤ employees.reporting_manager_id → profiles
                          │
task_category_groups 1─* task_categories
                          │
tasks *─1 task_categories     tasks *─1 employees (owner_id = accountable owner)
tasks 1─* task_assignments *─1 employees   (owner + contributors, with assignment history)
tasks 1─* task_comments / task_attachments / task_history / deadline_extensions / approvals
tasks *─1 supply_requirements   tasks *─1 vendors   tasks *─1 recurring_tasks
supply_requirements *─1 requesting_departments   supply_requirements 1─* requirement_history
costing_records *─1 vendors / employees / tasks   costing_records 1─* costing_history
costing_records ─ supersedes_id → costing_records (revision chain)
notifications *─1 profiles     notification_settings 1─1 profiles
audit_log (insert-only)        app_settings (key/value)
```

### Tables

| Table | Purpose / key columns |
|---|---|
| `profiles` | Portal users. `id` = auth user id, `full_name`, `email`, `role`, `team_id`, `is_active` |
| `teams` | Supply teams / sub-teams. `name`, `leader_id` |
| `employees` | Supply Team directory. `employee_code` (Employee ID), `designation`, `team_id`, `reporting_manager_id`, `joining_date`, `employment_status`, `daily_capacity_hours` |
| `task_category_groups` | A–F groups (Product Management, Costing & Pricing, …) |
| `task_categories` | Sub-categories; admin can add more; `default_effort_hours` |
| `requesting_departments` | Sales, Operations, Management, Product… (data, not users) |
| `vendors` | Supplier / DMC records |
| `tasks` | Core record: `task_code` (TSK-000001), title, description, category, `requirement_type` (urgent/ad hoc/standard), `priority` (critical/high/medium/low), `assigned_by`, `owner_id`, dates (`start_date`, `due_at`, `original_due_at`, `extension_count`), `estimated_hours`, `actual_hours`, `status`, `submitted_at`, `completed_at`, `approval_status`, `quality_rating`, `reopen_count`, `is_escalated`, links to requirement / vendor / recurring template |
| `task_assignments` | Owner + contributors, with `assigned_at` / `unassigned_at` (full assignment history) |
| `task_comments` | Typed activity: remark, progress, blocker, completion note, supplier response, delay reason |
| `task_attachments` | Storage paths for documents on tasks, requirements, costing records |
| `task_history` | Every status change (previous, new, by, at, remarks) and field change (priority, owner, deadline, category, title) |
| `approvals` | Task-completion, deadline-extension and costing approvals with decision + remarks |
| `deadline_extensions` | Extension requests: old/proposed deadline, reason, decision |
| `supply_requirements` | Requirement tracker: `req_code` (REQ-000001), department, requested by, description, destination, product, type, priority, `raised_at` (immutable), `required_by`, assignee, status, clarification / rejection / completion remarks, timestamps for each stage, linked task |
| `requirement_history` | Every requirement status change |
| `costing_records` | `costing_code`, Tour ID/name, destination, vendor, activity, existing cost, updated cost, currency, basis, transfer type, season, selling price, margin (generated), effective date, status, assignee, confirmation reference, approver |
| `costing_history` | Snapshot diff of every costing change |
| `notifications` | In-app notifications per user, `emailed_at` for email dispatch |
| `notification_settings` | Email preferences (management only) |
| `recurring_tasks` | Templates (daily / weekly / monthly) generated by the scheduler |
| `audit_log` | Insert-only: actor, action, entity, details JSON, timestamp |
| `app_settings` | Workload thresholds, escalation rules, scoring weights |

### Views (security-invoker, so RLS applies)

* `task_overview` — tasks joined with owner, category, group, assigner + derived
  `deadline_state` (on_track / upcoming / due_shortly / overdue / escalated / closed),
  `is_overdue`, `is_due_today`, `completion_hours`, `completed_on_time`.
* `requirement_overview` — requirements + department, assignee, `pending_days`, `is_delayed`.
* `costing_overview` — costing + vendor, assignee, `cost_change_pct`.

### Extensibility

UUID keys everywhere, enums only for workflow states, lookup tables for anything a business
user may want to extend (categories, departments, teams, vendors), `app_settings` for tunable
rules, and generic `approvals` / `audit_log` / `notifications` keyed by entity type so new
modules plug in without a rebuild.

---

## 3. UI wireframes

### Shell (desktop)
```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ ◆ Supply Hub │  Search…                         🔔3   ☾   Priya (Manager) ▾│
├──────────────┼────────────────────────────────────────────────────────────┤
│ ▣ Dashboard  │  Page title                               [+ New task]     │
│ ☰ All Tasks  │  ┌ filters: date · employee · category · priority · status ┐│
│ ◷ Daily Alloc│  └─────────────────────────────────────────────────────────┘│
│ ⇄ Requirements│  content                                                   │
│ ₹ Costing    │                                                            │
│ ▤ Product    │                                                            │
│ ⛟ Vendors    │                                                            │
│ ▥ Kanban     │                                                            │
│ ☺ Employees  │                                                            │
│ ▧ Reports    │                                                            │
│ ⎌ Audit      │                                                            │
│ ⚙ Settings   │                                                            │
└──────────────┴────────────────────────────────────────────────────────────┘
```
Mobile: sidebar collapses into a slide-over drawer (☰ button), tables become cards,
KPI grid becomes 2 columns, Kanban scrolls horizontally.

### Dashboard
```
[Total][New][Assigned][In progress][Pending clar.][Completed][Overdue][Critical][Due today][Awaiting review]
┌ Employee task distribution (stacked bar) ┐┌ Completion rate by employee ┐
┌ Daily completions (30d)  ┐┌ Weekly trend ┐┌ Monthly productivity ┐
┌ Pending vs completed ┐┌ Priority mix ┐┌ Overdue by employee ┐┌ Category mix ┐┌ Avg completion time ┐
Clicking any KPI or chart segment → drill-down drawer listing the matching tasks.
```

### Task detail (drawer / page)
```
TSK-000124  Peak season costing — Bali transfers          [Critical] [Urgent]
Status: In Progress ▾  [Submit for review] [Request extension] [Reassign]
Owner · Contributors · Category · Assigned by · Start · Due (orig / revised, ext×1)
Est 6h / Actual 4h · Approval: Pending
─ Activity ─────────────────────────────── ─ Attachments ─
[remark|progress|blocker|supplier response|delay reason]  file list + upload
timeline of comments + status changes (immutable)
```

### Requirement tracker
```
Tabs: All · New · Under review · Clarification · Assigned · In progress · Completed · Closed · Rejected
REQ-000031 | Sales | Rohan | Dubai desert safari private | Urgent | High | raised 3d ago | due in 1d | Owner | ⏱ 3.2d pending
Row → panel with [Accept] [Reject*] [Need clarification*] [Assign → creates task] [Close]
```

### Kanban
```
New | Not started | Assigned | In progress | Pending supplier | Pending clarif. | On hold | Awaiting review | Completed
cards draggable; drop → change_task_status() RPC with optional remark; Completed column = approval
```

### Daily allocation
```
Date ◀ 12 Nov 2026 ▶
Employee | Active | New | Due today | Critical | Overdue | Done today | Workload ■■■□ High | [Redistribute]
Daily closure report (completed / pending per employee) [Export]
```

---

## 4. Development plan (phases)

| Phase | Deliverable | Verification |
|---|---|---|
| 1 | Database schema, enums, constraints, views | migrations apply cleanly on Postgres 16 |
| 2 | Auth, profiles, roles, RLS, route protection | SQL tests: leader cannot see other teams; anon sees nothing |
| 3 | Employee directory + productivity | CRUD, deactivate, metrics from DB |
| 4 | Task creation, multi-assign, workflow, comments, attachments, extensions | SQL tests for guards & history; UI build |
| 5 | Supply Requirement Tracker | rejection requires reason, owner required, pending age |
| 6 | Costing & validation | approval requires confirmation, lock, revisions, history |
| 7 | Kanban + Daily allocation | drag → RPC → history |
| 8 | Dashboard + analytics + reports/exports | numbers from views; CSV/XLSX/PDF |
| 9 | Notifications + audit trail + deadline monitor | monitor test, audit rows |
| 10 | Tests + deployment docs | `npm run build`, SQL test suite, DEPLOYMENT.md |
