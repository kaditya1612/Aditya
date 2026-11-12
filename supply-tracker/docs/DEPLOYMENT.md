# Deployment guide

Production stack: **Supabase** (Postgres, Auth, Storage, pg_cron) + **Vercel** (Next.js).
Time required: about 30 minutes.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**. Pick a region close to the team (e.g. Mumbai `ap-south-1`).
   Save the database password in your password manager.
2. **Authentication → Sign In / Providers → Email**: keep Email enabled, and **turn off "Allow new users to sign up"**.
   Accounts are created only by the portal administrator. (Even if someone signs up, the database keeps them
   inactive with no access, but disabling sign-up removes the noise.)
3. **Database → Extensions**: make sure `pg_cron` is enabled (the migration enables it if available).

## 2. Apply the database migrations

Option A — Supabase CLI (recommended, keeps history):

```bash
npm install -g supabase
```

```bash
supabase login
```

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

```bash
supabase db push
```

Option B — SQL editor: open **SQL Editor** and run each file in `supabase/migrations/` **in filename order**.

The migrations create every table, constraint, trigger, workflow function, RLS policy, view, the private storage
bucket `supply-attachments`, the scheduled jobs, and the reference data (task categories A–F, requesting
departments, default team, workload/scoring settings). No dummy business data is inserted.

Verify: **Database → Cron Jobs** shows `supply-deadline-monitor` (every 15 min) and `supply-recurring-tasks` (daily).

## 3. Create the first administrator

**Authentication → Users → Add user → Create new user**, enter your email and a strong password, tick
*Auto Confirm User*. The very first account automatically becomes an **active Administrator**.

Every later user is created from inside the portal (**Settings → Users & access**), which sets their role through
the server-only admin API.

## 4. Deploy to Vercel

1. Push this repository to GitHub (already done if you are reading this on GitHub).
2. <https://vercel.com/new> → import the repository → set **Root Directory** to `supply-tracker`. Framework: Next.js.
3. Add environment variables (Project → Settings → Environment Variables):

| Variable | Where to find it | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | public (safe; RLS protects data) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → `anon` / publishable key | public (safe; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → `service_role` / secret key | **secret — server only** |
| `CRON_SECRET` | any long random string (`openssl rand -hex 32`) | **secret** |
| `NEXT_PUBLIC_SITE_URL` | your portal URL, e.g. `https://supply.yourco.com` | public |
| `RESEND_API_KEY` *(optional)* | <https://resend.com> API key, for management email alerts | **secret** |
| `NOTIFICATION_FROM_EMAIL` *(optional)* | verified sender, e.g. `Supply Portal <alerts@yourco.com>` | public |

4. Deploy. Then open the URL, sign in with the administrator account.

**Cron.** `vercel.json` schedules `/api/cron/monitor` daily (Vercel Hobby allows one daily cron; Pro can run it
every 15 minutes — change the schedule to `*/15 * * * *`). Vercel sends `Authorization: Bearer $CRON_SECRET`
automatically. The deadline monitor itself already runs every 15 minutes inside Supabase via pg_cron;
the Vercel cron additionally dispatches **email** notifications.

## 5. Configure the portal (first login)

1. **Settings → Teams & departments** — rename/add Supply teams; add requesting departments if needed.
2. **Settings → Users & access** — add the Supply Team Manager and Team Leaders. Give each leader a team:
   leaders only see employees (and their tasks) in their own team.
3. **Employee Productivity → Add employee** — enter every Supply Team member (Employee ID, designation,
   reporting manager, joining date, daily capacity).
4. **Vendor Management** — add DMCs and suppliers.
5. **Settings → Task categories / Rules & thresholds / Recurring tasks / Email notifications** as required.

## 6. Security checklist

- [x] Row-Level Security on every table; anonymous role has no table privileges.
- [x] Roles stored in `app_metadata` (not user-editable); self sign-ups stay inactive.
- [x] No `DELETE` privilege on any table; history, comments and audit log are append-only.
- [x] Workflow rules (approvals, deadline extensions, costing confirmation, rejection reasons) enforced in Postgres.
- [x] Service-role key used only in `/api/admin/users` (after verifying the caller is an admin) and `/api/cron/monitor`
      (after a constant-time `CRON_SECRET` check). Never prefixed `NEXT_PUBLIC_`.
- [x] Private storage bucket; access checked per task/costing record via storage RLS; downloads use 2-minute signed URLs.
- [x] Security headers (HSTS, X-Frame-Options DENY, nosniff, referrer policy); `robots: noindex`.
- [x] Exports neutralise spreadsheet formula injection.
- [ ] Enable **MFA** for administrator accounts (Supabase Auth → MFA) — recommended.
- [ ] Set a custom SMTP sender in Supabase Auth for password-reset emails — recommended.

## 7. Backup strategy

| Layer | What | How |
|---|---|---|
| Automatic | Daily full database backups | Supabase Pro plan keeps 7 days (Team: 14, Enterprise: 30). Restore from **Database → Backups**. |
| Point-in-time | Restore to any second | Enable the **PITR** add-on for critical periods (recommended once the team relies on it daily). |
| Off-site | Weekly logical dump you control | `supabase db dump --linked -f backup-$(date +%F).sql` (and `--data-only` for data) from a scheduled GitHub Action or an admin laptop; store encrypted in company storage. |
| Files | Uploaded supporting documents | Storage objects are included in Supabase's managed backups; for off-site copies sync the `supply-attachments` bucket with the S3-compatible endpoint (`rclone`/`aws s3 sync`). |
| Business continuity | Records are never deleted | Every table is append-only or soft-deactivated, and `audit_log` lets you reconstruct who changed what. |

Test a restore into a scratch project once a quarter.

## 8. Updating

Schema changes go in a **new** migration file (`supabase migration new <name>`), never by editing an applied one.
Run `npm run test:db` locally (any Postgres 15+), then `supabase db push`, then push the code — Vercel redeploys.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Login works but you're sent back with "account is not active" | The profile is inactive: an admin activates it in Settings → Users & access. |
| "Supabase environment variables are not configured" | Set the `NEXT_PUBLIC_SUPABASE_*` variables in Vercel and redeploy. |
| Adding users fails with "SUPABASE_SERVICE_ROLE_KEY is not configured" | Add the service-role key to Vercel (server-side variable). |
| No deadline alerts | Check **Database → Cron Jobs** for `supply-deadline-monitor`; enable `pg_cron`. |
| Notification badge doesn't update live | Realtime is optional; the badge also refreshes every 60 s. Enable Realtime for `notifications` under Database → Publications. |
