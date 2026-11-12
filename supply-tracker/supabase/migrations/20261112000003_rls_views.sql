-- =====================================================================
-- Supply Team Portal — row-level security, grants, views
-- Principle: deny by default. Only active portal users (admin/manager/leader)
-- can read anything; leaders are limited to their team. History, comments
-- and the audit log are append-only for everyone.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'teams', 'profiles', 'employees', 'task_category_groups', 'task_categories', 'requesting_departments',
    'vendors', 'supply_requirements', 'recurring_tasks', 'tasks', 'task_assignments', 'task_comments',
    'task_history', 'deadline_extensions', 'costing_records', 'costing_history', 'task_attachments',
    'approvals', 'requirement_history', 'notifications', 'notification_settings', 'audit_log', 'app_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------- Reference data: readable by all active users, admin-managed ----------
create policy teams_read on public.teams for select to authenticated using (public.is_active_user());
create policy teams_admin on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy groups_read on public.task_category_groups for select to authenticated using (public.is_active_user());
create policy groups_admin on public.task_category_groups for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy categories_read on public.task_categories for select to authenticated using (public.is_active_user());
create policy categories_admin on public.task_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy departments_read on public.requesting_departments for select to authenticated using (public.is_active_user());
create policy departments_admin on public.requesting_departments for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.app_settings for select to authenticated using (public.is_active_user());
create policy settings_admin on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Profiles ----------
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Employees ----------
create policy employees_read on public.employees for select to authenticated
  using (public.can_access_employee(id));
create policy employees_insert on public.employees for insert to authenticated with check (public.is_manager());
create policy employees_update on public.employees for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ---------- Vendors ----------
create policy vendors_read on public.vendors for select to authenticated using (public.is_active_user());
create policy vendors_insert on public.vendors for insert to authenticated with check (public.is_active_user());
create policy vendors_update on public.vendors for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- ---------- Tasks ----------
create policy tasks_read on public.tasks for select to authenticated using (public.can_access_task(id));
create policy tasks_insert on public.tasks for insert to authenticated with check (
  public.is_manager()
  or (public.current_app_role() = 'leader' and owner_id is not null and public.can_access_employee(owner_id))
);
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_access_task(id)) with check (public.can_access_task(id));

create policy assignments_read on public.task_assignments for select to authenticated using (public.can_access_task(task_id));
create policy history_read on public.task_history for select to authenticated using (public.can_access_task(task_id));
create policy extensions_read on public.deadline_extensions for select to authenticated using (public.can_access_task(task_id));

create policy comments_read on public.task_comments for select to authenticated using (public.can_access_task(task_id));
create policy comments_insert on public.task_comments for insert to authenticated
  with check (public.can_access_task(task_id) and author_id = auth.uid());

-- ---------- Requirements: whole Supply Team sees the intake queue ----------
create policy requirements_read on public.supply_requirements for select to authenticated using (public.is_active_user());
create policy requirements_insert on public.supply_requirements for insert to authenticated with check (public.is_active_user());
create policy requirements_update on public.supply_requirements for update to authenticated
  using (public.is_manager() or created_by = auth.uid() or public.can_access_employee(assigned_employee_id))
  with check (public.is_active_user());
create policy requirement_history_read on public.requirement_history for select to authenticated using (public.is_active_user());

-- ---------- Costing ----------
create policy costing_read on public.costing_records for select to authenticated using (public.can_access_costing(id));
create policy costing_insert on public.costing_records for insert to authenticated with check (
  public.is_manager() or (public.is_active_user() and (assigned_employee_id is null or public.can_access_employee(assigned_employee_id)))
);
create policy costing_update on public.costing_records for update to authenticated
  using (public.can_access_costing(id)) with check (public.is_manager() or assigned_employee_id is null or public.can_access_employee(assigned_employee_id));
create policy costing_history_read on public.costing_history for select to authenticated using (public.can_access_costing(costing_id));

-- ---------- Attachments ----------
create policy attachments_read on public.task_attachments for select to authenticated using (
  (task_id is not null and public.can_access_task(task_id))
  or (requirement_id is not null and public.is_active_user())
  or (costing_id is not null and public.can_access_costing(costing_id))
);
create policy attachments_insert on public.task_attachments for insert to authenticated with check (
  uploaded_by = auth.uid() and (
    (task_id is not null and public.can_access_task(task_id))
    or (requirement_id is not null and public.is_active_user())
    or (costing_id is not null and public.can_access_costing(costing_id)))
);

-- ---------- Approvals ----------
create policy approvals_read on public.approvals for select to authenticated using (
  public.is_manager()
  or (task_id is not null and public.can_access_task(task_id))
  or (costing_id is not null and public.can_access_costing(costing_id))
);

-- ---------- Recurring tasks ----------
create policy recurring_read on public.recurring_tasks for select to authenticated
  using (public.is_manager() or public.can_access_employee(owner_id));
create policy recurring_write on public.recurring_tasks for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ---------- Notifications: own only ----------
create policy notifications_own on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy notification_settings_own on public.notification_settings for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());
create policy notification_settings_update on public.notification_settings for update to authenticated
  using ((profile_id = auth.uid() and public.is_manager()) or public.is_admin())
  with check ((profile_id = auth.uid() and public.is_manager()) or public.is_admin());

-- ---------- Audit: managers/admins read; nobody writes directly ----------
create policy audit_read on public.audit_log for select to authenticated using (public.is_manager());

-- ---------- Column-level grants (defence in depth on top of RLS) ----------
-- Supabase grants ALL to API roles by default; reset to least privilege first.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant insert, update on public.teams, public.task_category_groups, public.task_categories,
  public.requesting_departments, public.app_settings, public.employees, public.vendors,
  public.recurring_tasks to authenticated;
grant update (full_name, role, team_id, is_active) on public.profiles to authenticated;

grant insert on public.tasks to authenticated;
grant update (title, description, category_id, requirement_type, priority, status, owner_id, due_at,
  start_date, estimated_hours, actual_hours, completion_remarks, destination, vendor_id) on public.tasks to authenticated;

grant insert on public.supply_requirements to authenticated;
grant update (department_id, requested_by_name, description, destination, product_name, requirement_type,
  priority, required_by) on public.supply_requirements to authenticated;

grant insert on public.costing_records to authenticated;
grant update (tour_code, tour_name, destination, vendor_id, supplier_name, activity_type, existing_cost, updated_cost,
  currency, costing_basis, transfer_type, season, selling_price, effective_date, assigned_employee_id, task_id,
  confirmation_reference, remarks) on public.costing_records to authenticated;

grant insert on public.task_comments, public.task_attachments to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (email_enabled, email_types) on public.notification_settings to authenticated;
-- No DELETE is granted on any table: records are deactivated / cancelled, never erased.
-- task_history, requirement_history, costing_history, approvals, deadline_extensions, audit_log
-- and task_assignments are written only by SECURITY DEFINER workflow functions.

revoke execute on function public.run_deadline_monitor() from public, anon, authenticated;
revoke execute on function public.generate_recurring_tasks() from public, anon, authenticated;
revoke execute on function public.log_audit(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.notify(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.notify_managers(text, text, text, text, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.notify_task_stakeholders(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.apply_deadline_extension(uuid) from public, anon, authenticated;

-- ---------- Views (security_invoker → caller's RLS applies) ----------
create or replace view public.task_overview with (security_invoker = true) as
select
  t.*,
  e.full_name  as owner_name,
  e.employee_code as owner_code,
  e.team_id    as owner_team_id,
  c.name       as category_name,
  g.code       as category_group_code,
  g.name       as category_group_name,
  ab.full_name as assigned_by_name,
  v.name       as vendor_name,
  rq.req_code  as requirement_code,
  public.task_deadline_state(t.status, t.priority, t.due_at) as deadline_state,
  (t.due_at is not null and t.status not in ('completed', 'cancelled')
     and coalesce(case when t.status = 'awaiting_review' then t.submitted_at end, now()) > t.due_at) as is_overdue,
  (t.due_at is not null and (t.due_at at time zone public.app_tz())::date = (now() at time zone public.app_tz())::date
     and t.status not in ('completed', 'cancelled')) as is_due_today,
  case when t.status = 'completed' then
    round((extract(epoch from (coalesce(t.submitted_at, t.completed_at) - coalesce(t.started_at, t.created_at))) / 3600)::numeric, 2)
  end as completion_hours,
  case when t.status = 'completed' and t.due_at is not null then coalesce(t.submitted_at, t.completed_at) <= t.due_at end as completed_on_time,
  (select coalesce(array_agg(ce.full_name order by ce.full_name), '{}')
     from public.task_assignments a join public.employees ce on ce.id = a.employee_id
    where a.task_id = t.id and a.unassigned_at is null and not a.is_owner) as contributor_names,
  (select coalesce(array_agg(a.employee_id), '{}')
     from public.task_assignments a where a.task_id = t.id and a.unassigned_at is null and not a.is_owner) as contributor_ids
from public.tasks t
join public.task_categories c on c.id = t.category_id
join public.task_category_groups g on g.id = c.group_id
left join public.employees e on e.id = t.owner_id
left join public.profiles ab on ab.id = t.assigned_by
left join public.vendors v on v.id = t.vendor_id
left join public.supply_requirements rq on rq.id = t.requirement_id;

create or replace view public.requirement_overview with (security_invoker = true) as
select
  r.*,
  d.name as department_name,
  e.full_name as assignee_name,
  t.task_code,
  t.status as task_status,
  round((extract(epoch from (coalesce(r.completed_at, r.closed_at, case when r.status = 'rejected' then r.reviewed_at end, now()) - r.raised_at)) / 86400)::numeric, 1) as pending_days,
  (r.required_by is not null and r.status not in ('closed', 'rejected')
     and coalesce((r.completed_at at time zone public.app_tz())::date, (now() at time zone public.app_tz())::date) > r.required_by) as is_delayed
from public.supply_requirements r
join public.requesting_departments d on d.id = r.department_id
left join public.employees e on e.id = r.assigned_employee_id
left join public.tasks t on t.id = r.task_id;

create or replace view public.costing_overview with (security_invoker = true) as
select
  c.*,
  v.name as vendor_name,
  e.full_name as assignee_name,
  p.full_name as approved_by_name,
  case when c.existing_cost > 0 and c.updated_cost is not null
    then round(((c.updated_cost - c.existing_cost) / c.existing_cost) * 100, 2) end as cost_change_pct
from public.costing_records c
left join public.vendors v on v.id = c.vendor_id
left join public.employees e on e.id = c.assigned_employee_id
left join public.profiles p on p.id = c.approved_by;

grant select on public.task_overview, public.requirement_overview, public.costing_overview to authenticated;
