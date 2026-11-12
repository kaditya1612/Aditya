-- =====================================================================
-- Supply Team Portal — helpers, triggers and workflow RPCs
--
-- Guard pattern: BEFORE UPDATE triggers reject workflow-field changes when
-- the statement runs as an API role (authenticated/anon). Workflow RPCs are
-- SECURITY DEFINER (run as the owner), validate the caller's role, and are
-- therefore the only way to move statuses, deadlines and approvals.
-- =====================================================================

-- ---------- Identity helpers ----------
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin', 'manager'), false)
$$;

create or replace function public.current_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_api_role() returns boolean
language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

create or replace function public.can_access_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_employee is null then false
    when public.is_manager() then true
    when public.current_app_role() = 'leader' then exists (
      select 1 from public.employees e
      where e.id = p_employee
        and ((public.current_team_id() is not null and e.team_id = public.current_team_id())
             or e.reporting_manager_id = auth.uid()))
    else false end
$$;

create or replace function public.can_access_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.is_manager() then true
    when public.current_app_role() = 'leader' then exists (
      select 1 from public.tasks t
      where t.id = p_task
        and (t.created_by = auth.uid() or t.assigned_by = auth.uid()
             or public.can_access_employee(t.owner_id)
             or exists (select 1 from public.task_assignments a
                        where a.task_id = t.id and a.unassigned_at is null
                          and public.can_access_employee(a.employee_id))))
    else false end
$$;

create or replace function public.employee_is_active(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where id = p_id and employment_status <> 'inactive')
$$;

create or replace function public.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), 'System')
$$;

create or replace function public.employee_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name from public.employees where id = p_id
$$;

create or replace function public.app_setting(p_key text, p_default jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = p_key), p_default)
$$;

create or replace function public.app_tz() returns text
language sql stable as $$
  select coalesce(public.app_setting('timezone', '"Asia/Kolkata"'::jsonb) #>> '{}', 'Asia/Kolkata')
$$;

create or replace function public.require_active_user() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() then
    raise exception 'Not authorised: an active portal account is required' using errcode = '42501';
  end if;
end $$;

create or replace function public.require_manager() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'Only the Supply Team Manager or an Administrator can perform this action' using errcode = '42501';
  end if;
end $$;

-- ---------- Audit + notifications ----------
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_entity_code text, p_details jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log(actor_id, actor_name, action, entity_type, entity_id, entity_code, details)
  values (auth.uid(), public.actor_name(), p_action, p_entity_type, p_entity_id, p_entity_code, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.notify(
  p_recipient uuid, p_type text, p_title text, p_body text,
  p_entity_type text, p_entity_id uuid, p_link text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or p_recipient = auth.uid() then return; end if;
  if not exists (select 1 from public.profiles where id = p_recipient and is_active) then return; end if;
  insert into public.notifications(recipient_id, type, title, body, entity_type, entity_id, link)
  values (p_recipient, p_type, p_title, p_body, p_entity_type, p_entity_id, p_link);
end $$;

create or replace function public.notify_managers(
  p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_link text,
  p_include_admins boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles
           where is_active and (role = 'manager' or (p_include_admins and role = 'admin'))
  loop
    perform public.notify(r.id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_link);
  end loop;
end $$;

-- Assigner, creator, owner's reporting manager, leaders of the owner's team (+ managers)
create or replace function public.notify_task_stakeholders(
  p_task uuid, p_type text, p_title text, p_body text, p_include_managers boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare r record; t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if not found then return; end if;
  for r in
    select distinct pid from (
      select t.assigned_by as pid
      union select t.created_by
      union select e.reporting_manager_id from public.employees e where e.id = t.owner_id
      union select p.id from public.profiles p join public.employees e on e.team_id = p.team_id
            where e.id = t.owner_id and p.role = 'leader' and p.is_active
      union select p.id from public.profiles p where p_include_managers and p.role = 'manager' and p.is_active
    ) s where pid is not null
  loop
    perform public.notify(r.pid, p_type, p_title, p_body, 'task', t.id, '/tasks/' || t.id);
  end loop;
end $$;

-- ---------- Generic row audit for master data ----------
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_changed jsonb := '{}'::jsonb; k text; v_entity text := TG_ARGV[0];
begin
  if TG_OP = 'INSERT' then
    perform public.log_audit(v_entity || '.created', v_entity, (to_jsonb(new)->>'id')::uuid,
      coalesce(to_jsonb(new)->>'employee_code', to_jsonb(new)->>'vendor_code', to_jsonb(new)->>'name', to_jsonb(new)->>'full_name', to_jsonb(new)->>'key'),
      to_jsonb(new));
    return new;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  for k in select jsonb_object_keys(v_new) loop
    if k not in ('updated_at') and (v_old -> k) is distinct from (v_new -> k) then
      v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
    end if;
  end loop;
  if v_changed <> '{}'::jsonb then
    perform public.log_audit(v_entity || '.updated', v_entity, (v_new->>'id')::uuid,
      coalesce(v_new->>'employee_code', v_new->>'vendor_code', v_new->>'name', v_new->>'full_name', v_new->>'key'),
      v_changed);
  end if;
  return new;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- Profiles ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_first boolean; v_role public.app_role; v_active boolean;
begin
  v_first := not exists (select 1 from public.profiles);
  if v_first then
    v_role := 'admin'; v_active := true;          -- bootstrap: the first account is the administrator
  elsif coalesce(new.raw_app_meta_data->>'role', '') in ('admin', 'manager', 'leader') then
    v_role := (new.raw_app_meta_data->>'role')::public.app_role; v_active := true;  -- created by an admin (app_metadata is server-only)
  else
    v_role := 'leader'; v_active := false;        -- any other sign-up stays inactive until an admin enables it
  end if;
  insert into public.profiles(id, full_name, email, role, team_id, is_active)
  values (new.id,
          coalesce(nullif(new.raw_app_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          new.email, v_role, nullif(new.raw_app_meta_data->>'team_id', '')::uuid, v_active);
  insert into public.notification_settings(profile_id, email_enabled) values (new.id, false);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.id <> old.id or new.email <> old.email then
    raise exception 'Profile id and email cannot be changed here';
  end if;
  if (old.role = 'admin' and old.is_active) and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.profiles where role = 'admin' and is_active and id <> old.id) then
    raise exception 'At least one active administrator must remain';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

-- ---------- Task triggers ----------
create or replace function public.tasks_before_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.assigned_by := coalesce(new.assigned_by, auth.uid());
  new.created_at := now();
  new.updated_at := now();
  new.original_due_at := new.due_at;
  new.extension_count := 0;
  if public.is_api_role() then
    if new.status not in ('new', 'not_started', 'assigned') then
      raise exception 'New tasks must start as New, Not Started or Assigned';
    end if;
    new.approval_status := 'not_required';
    new.approved_by := null; new.approved_at := null; new.quality_rating := null;
    new.started_at := null; new.submitted_at := null; new.completed_at := null;
    new.reopen_count := 0; new.is_escalated := false; new.escalated_at := null; new.deadline_alert_level := null;
  end if;
  if new.owner_id is not null and new.status = 'new' then
    new.status := 'assigned';
  end if;
  if new.owner_id is not null and not public.employee_is_active(new.owner_id) then
    raise exception 'Tasks can only be assigned to active employees';
  end if;
  return new;
end $$;

create or replace function public.tasks_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.task_code := old.task_code;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  if old.original_due_at is not null then
    new.original_due_at := old.original_due_at;     -- original deadline is permanent
  end if;
  if public.is_api_role() then
    if new.status is distinct from old.status then
      raise exception 'Status changes must go through the workflow (change_task_status)';
    end if;
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Reassignment must go through reassign_task';
    end if;
    if new.due_at is distinct from old.due_at then
      if old.due_at is null then
        new.original_due_at := new.due_at;           -- first deadline being set
      else
        raise exception 'Deadlines cannot be changed directly. Request a deadline extension for manager approval.';
      end if;
    end if;
    if new.priority is distinct from old.priority and not public.is_manager() then
      raise exception 'Only the Supply Team Manager can change task priority';
    end if;
    -- workflow-owned columns are silently protected
    new.approval_status := old.approval_status; new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    new.quality_rating := old.quality_rating; new.reopen_count := old.reopen_count; new.extension_count := old.extension_count;
    new.is_escalated := old.is_escalated; new.escalated_at := old.escalated_at; new.deadline_alert_level := old.deadline_alert_level;
    new.started_at := old.started_at; new.submitted_at := old.submitted_at; new.completed_at := old.completed_at;
    new.last_delay_reason := old.last_delay_reason; new.assigned_by := old.assigned_by;
    if old.status in ('completed', 'cancelled') then
      raise exception 'Closed tasks are read-only. Reopen the task first.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tasks_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.task_assignments(task_id, employee_id, is_owner, assigned_by)
    values (new.id, new.owner_id, true, new.assigned_by);
  end if;
  insert into public.task_history(task_id, field, new_status, new_value, remarks, changed_by)
  values (new.id, 'status', new.status, new.status::text, 'Task created', auth.uid());
  perform public.log_audit('task.created', 'task', new.id, new.task_code,
    jsonb_build_object('title', new.title, 'priority', new.priority, 'requirement_type', new.requirement_type,
                       'owner', public.employee_name(new.owner_id), 'due_at', new.due_at));
  if new.owner_id is not null then
    perform public.log_audit('task.assigned', 'task', new.id, new.task_code,
      jsonb_build_object('owner', public.employee_name(new.owner_id)));
    perform public.notify_task_stakeholders(new.id, 'task_assigned',
      'New task assigned: ' || new.task_code,
      new.title || ' → ' || coalesce(public.employee_name(new.owner_id), '—'), new.priority = 'critical');
  end if;
  return new;
end $$;

create or replace function public.tasks_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_remarks text := nullif(current_setting('app.remarks', true), '');
begin
  if new.status is distinct from old.status then
    insert into public.task_history(task_id, field, previous_status, new_status, old_value, new_value, remarks, changed_by)
    values (new.id, 'status', old.status, new.status, old.status::text, new.status::text, v_remarks, v_actor);
    perform public.log_audit(
      case new.status when 'completed' then 'task.closed' when 'cancelled' then 'task.cancelled'
                      when 'reopened' then 'task.reopened' else 'task.status_changed' end,
      'task', new.id, new.task_code,
      jsonb_build_object('from', old.status, 'to', new.status, 'remarks', v_remarks));
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_history(task_id, field, old_value, new_value, remarks, changed_by)
    values (new.id, 'priority', old.priority::text, new.priority::text, v_remarks, v_actor);
    perform public.log_audit('task.priority_changed', 'task', new.id, new.task_code,
      jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into public.task_history(task_id, field, old_value, new_value, remarks, changed_by)
    values (new.id, 'owner', public.employee_name(old.owner_id), public.employee_name(new.owner_id), v_remarks, v_actor);
    perform public.log_audit(case when old.owner_id is null then 'task.assigned' else 'task.reassigned' end,
      'task', new.id, new.task_code,
      jsonb_build_object('from', public.employee_name(old.owner_id), 'to', public.employee_name(new.owner_id), 'remarks', v_remarks));
  end if;
  if new.due_at is distinct from old.due_at then
    insert into public.task_history(task_id, field, old_value, new_value, remarks, changed_by)
    values (new.id, 'deadline', old.due_at::text, new.due_at::text, v_remarks, v_actor);
    perform public.log_audit('task.deadline_changed', 'task', new.id, new.task_code,
      jsonb_build_object('from', old.due_at, 'to', new.due_at, 'original', new.original_due_at,
                         'extension_count', new.extension_count, 'reason', v_remarks));
  end if;
  if new.category_id is distinct from old.category_id or new.title is distinct from old.title
     or new.requirement_type is distinct from old.requirement_type
     or new.estimated_hours is distinct from old.estimated_hours then
    insert into public.task_history(task_id, field, old_value, new_value, changed_by)
    select new.id, f, o, n, v_actor from (values
      ('category', (select name from public.task_categories where id = old.category_id), (select name from public.task_categories where id = new.category_id)),
      ('title', old.title, new.title),
      ('requirement_type', old.requirement_type::text, new.requirement_type::text),
      ('estimated_hours', old.estimated_hours::text, new.estimated_hours::text)
    ) v(f, o, n) where o is distinct from n;
    perform public.log_audit('task.updated', 'task', new.id, new.task_code, '{}'::jsonb);
  end if;
  return new;
end $$;

create trigger tasks_before_insert before insert on public.tasks for each row execute function public.tasks_before_insert();
create trigger tasks_before_update before update on public.tasks for each row execute function public.tasks_before_update();
create trigger tasks_after_insert after insert on public.tasks for each row execute function public.tasks_after_insert();
create trigger tasks_after_update after update on public.tasks for each row execute function public.tasks_after_update();

-- ---------- Task workflow RPCs ----------
create or replace function public.change_task_status(
  p_task_id uuid, p_status public.task_status, p_remarks text default null, p_actual_hours numeric default null
) returns public.tasks
language plpgsql security definer set search_path = public as $$
declare t public.tasks; v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
begin
  perform public.require_active_user();
  if not public.can_access_task(p_task_id) then
    raise exception 'You do not have access to this task' using errcode = '42501';
  end if;
  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if t.status = p_status then return t; end if;

  if p_status = 'completed' then
    raise exception 'Tasks are completed through manager approval. Move the task to Awaiting Review.';
  end if;
  if t.status in ('completed', 'cancelled') and p_status <> 'reopened' then
    raise exception 'Closed tasks can only be reopened';
  end if;
  if p_status = 'reopened' then
    if t.status not in ('completed', 'cancelled') then
      raise exception 'Only completed or cancelled tasks can be reopened';
    end if;
    perform public.require_manager();
  end if;
  if p_status = 'cancelled' then perform public.require_manager(); end if;
  if p_status in ('cancelled', 'reopened', 'on_hold') and v_remarks is null then
    raise exception 'Remarks are required when moving a task to %', p_status;
  end if;
  if p_status not in ('new', 'not_started', 'cancelled') and t.owner_id is null then
    raise exception 'Assign an accountable owner before moving the task to %', p_status;
  end if;

  perform set_config('app.remarks', coalesce(v_remarks, ''), true);

  -- leaving review without a decision withdraws the pending approval
  if t.status = 'awaiting_review' then
    update public.approvals set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           remarks = coalesce(v_remarks, 'Withdrawn from review')
     where task_id = t.id and kind = 'task_completion' and status = 'pending';
    t.approval_status := 'not_required';
  end if;

  update public.tasks set
    status = p_status,
    started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
    submitted_at = case when p_status = 'awaiting_review' then now() else submitted_at end,
    completion_remarks = case when p_status = 'awaiting_review' then coalesce(v_remarks, completion_remarks) else completion_remarks end,
    actual_hours = coalesce(p_actual_hours, actual_hours),
    approval_status = case when p_status = 'awaiting_review' then 'pending'::public.approval_status
                           when p_status = 'reopened' then 'not_required'::public.approval_status
                           else t.approval_status end,
    reopen_count = reopen_count + case when p_status = 'reopened' then 1 else 0 end,
    completed_at = case when p_status = 'reopened' then null else completed_at end
  where id = p_task_id
  returning * into t;

  if p_status = 'awaiting_review' then
    insert into public.approvals(kind, task_id, requested_by, remarks)
    values ('task_completion', t.id, auth.uid(), v_remarks);
    perform public.notify_managers('approval_request', 'Approval requested: ' || t.task_code,
      t.title || ' is awaiting review', 'task', t.id, '/tasks/' || t.id);
  elsif p_status = 'pending_supplier' then
    perform public.notify_task_stakeholders(t.id, 'pending_supplier', 'Pending supplier response: ' || t.task_code,
      coalesce(v_remarks, t.title));
  elsif p_status in ('reopened', 'cancelled', 'on_hold') then
    perform public.notify_task_stakeholders(t.id, 'task_' || p_status::text, initcap(replace(p_status::text, '_', ' ')) || ': ' || t.task_code,
      coalesce(v_remarks, t.title));
  end if;

  -- keep the linked requirement in step
  if p_status = 'in_progress' and t.requirement_id is not null then
    update public.supply_requirements set status = 'in_progress'
     where id = t.requirement_id and status = 'assigned';
  end if;
  return t;
end $$;

create or replace function public.decide_task_approval(
  p_task_id uuid, p_approve boolean, p_remarks text default null, p_quality smallint default null
) returns public.tasks
language plpgsql security definer set search_path = public as $$
declare t public.tasks; v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
begin
  perform public.require_manager();
  select * into t from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if t.status <> 'awaiting_review' then
    raise exception 'Only tasks awaiting review can be approved or rejected';
  end if;
  if not p_approve and v_remarks is null then
    raise exception 'A reason is required when rejecting a completed task';
  end if;
  if p_quality is not null and (p_quality < 1 or p_quality > 5) then
    raise exception 'Quality rating must be between 1 and 5';
  end if;

  perform set_config('app.remarks', coalesce(v_remarks, case when p_approve then 'Approved' else '' end), true);

  update public.approvals set status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
         decided_by = auth.uid(), decided_at = now(), remarks = v_remarks
   where task_id = t.id and kind = 'task_completion' and status = 'pending';

  if p_approve then
    update public.tasks set status = 'completed', approval_status = 'approved', approved_by = auth.uid(),
           approved_at = now(), completed_at = now(), quality_rating = coalesce(p_quality, quality_rating),
           submitted_at = coalesce(submitted_at, now())
     where id = t.id returning * into t;
    perform public.log_audit('task.approved', 'task', t.id, t.task_code,
      jsonb_build_object('quality_rating', p_quality, 'remarks', v_remarks));
    perform public.notify_task_stakeholders(t.id, 'task_completed', 'Task completed: ' || t.task_code, t.title);
    if t.requirement_id is not null then
      update public.supply_requirements
         set status = 'completed', completed_at = now(),
             completion_remarks = coalesce(completion_remarks, t.completion_remarks)
       where id = t.requirement_id and status in ('assigned', 'in_progress');
    end if;
  else
    update public.tasks set status = 'reopened', approval_status = 'rejected', reopen_count = reopen_count + 1,
           quality_rating = coalesce(p_quality, quality_rating)
     where id = t.id returning * into t;
    perform public.log_audit('task.rejected', 'task', t.id, t.task_code, jsonb_build_object('remarks', v_remarks));
    perform public.notify_task_stakeholders(t.id, 'task_rejected', 'Completion rejected: ' || t.task_code, v_remarks);
  end if;
  return t;
end $$;

create or replace function public.reassign_task(
  p_task_id uuid, p_owner uuid, p_contributors uuid[] default null, p_remarks text default null
) returns public.tasks
language plpgsql security definer set search_path = public as $$
declare t public.tasks; v_emp uuid; v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
begin
  perform public.require_active_user();
  if not public.can_access_task(p_task_id) then
    raise exception 'You do not have access to this task' using errcode = '42501';
  end if;
  if p_owner is null then raise exception 'An accountable owner is required'; end if;
  if not public.can_access_employee(p_owner) then
    raise exception 'You can only assign tasks to employees within your scope' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_owner and employment_status <> 'inactive') then
    raise exception 'Owner must be an active employee';
  end if;
  if p_contributors is not null then
    foreach v_emp in array p_contributors loop
      if not public.can_access_employee(v_emp) then
        raise exception 'Contributor is outside your scope' using errcode = '42501';
      end if;
    end loop;
  end if;
  select * into t from public.tasks where id = p_task_id for update;
  if t.status in ('completed', 'cancelled') then raise exception 'Closed tasks cannot be reassigned'; end if;

  perform set_config('app.remarks', coalesce(v_remarks, ''), true);

  -- close assignments that no longer apply
  update public.task_assignments set unassigned_at = now()
   where task_id = t.id and unassigned_at is null
     and (employee_id <> p_owner and (p_contributors is null and is_owner or p_contributors is not null and not (employee_id = any(p_contributors))));
  update public.task_assignments set is_owner = (employee_id = p_owner)
   where task_id = t.id and unassigned_at is null;
  if not exists (select 1 from public.task_assignments where task_id = t.id and employee_id = p_owner and unassigned_at is null) then
    insert into public.task_assignments(task_id, employee_id, is_owner, assigned_by) values (t.id, p_owner, true, auth.uid());
  end if;
  if p_contributors is not null then
    insert into public.task_assignments(task_id, employee_id, is_owner, assigned_by)
    select t.id, c, false, auth.uid() from unnest(p_contributors) c
     where c <> p_owner and not exists (select 1 from public.task_assignments a
                                         where a.task_id = t.id and a.employee_id = c and a.unassigned_at is null);
  end if;

  if t.owner_id is distinct from p_owner then
    update public.tasks set owner_id = p_owner,
           status = case when status in ('new', 'not_started') then 'assigned'::public.task_status else status end
     where id = t.id returning * into t;
    perform public.notify_task_stakeholders(t.id, 'task_reassigned', 'Task reassigned: ' || t.task_code,
      t.title || ' → ' || public.employee_name(p_owner), t.priority = 'critical');
  elsif p_contributors is not null then
    perform public.log_audit('task.contributors_updated', 'task', t.id, t.task_code,
      jsonb_build_object('contributors', (select jsonb_agg(public.employee_name(c)) from unnest(p_contributors) c)));
  end if;
  return t;
end $$;

-- ---------- Deadline extensions ----------
create or replace function public.apply_deadline_extension(p_ext uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.deadline_extensions;
begin
  select * into x from public.deadline_extensions where id = p_ext;
  perform set_config('app.remarks', x.reason, true);
  update public.tasks set due_at = x.proposed_due_at, extension_count = extension_count + 1,
         last_delay_reason = x.reason, deadline_alert_level = null, is_escalated = false, escalated_at = null
   where id = x.task_id;
  insert into public.task_comments(task_id, author_id, kind, body)
  values (x.task_id, x.requested_by, 'delay_reason', x.reason);
end $$;

create or replace function public.request_deadline_extension(
  p_task_id uuid, p_new_due timestamptz, p_reason text
) returns public.deadline_extensions
language plpgsql security definer set search_path = public as $$
declare t public.tasks; x public.deadline_extensions; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.require_active_user();
  if not public.can_access_task(p_task_id) then
    raise exception 'You do not have access to this task' using errcode = '42501';
  end if;
  if v_reason is null then raise exception 'A reason for the delay is required'; end if;
  if p_new_due is null then raise exception 'A new deadline is required'; end if;
  select * into t from public.tasks where id = p_task_id for update;
  if t.status in ('completed', 'cancelled') then raise exception 'Closed tasks cannot be extended'; end if;
  if t.due_at is not distinct from p_new_due then raise exception 'The new deadline is the same as the current one'; end if;
  if exists (select 1 from public.deadline_extensions where task_id = t.id and status = 'pending') then
    raise exception 'An extension request is already pending for this task';
  end if;

  insert into public.deadline_extensions(task_id, requested_by, old_due_at, proposed_due_at, reason, status)
  values (t.id, auth.uid(), t.due_at, p_new_due, v_reason, 'pending') returning * into x;

  if public.is_manager() then
    update public.deadline_extensions set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_remarks = 'Revised by manager' where id = x.id returning * into x;
    insert into public.approvals(kind, task_id, extension_id, status, requested_by, decided_by, decided_at, remarks)
    values ('deadline_extension', t.id, x.id, 'approved', auth.uid(), auth.uid(), now(), v_reason);
    perform public.apply_deadline_extension(x.id);
  else
    insert into public.approvals(kind, task_id, extension_id, requested_by, remarks)
    values ('deadline_extension', t.id, x.id, auth.uid(), v_reason);
    perform public.log_audit('task.extension_requested', 'task', t.id, t.task_code,
      jsonb_build_object('from', t.due_at, 'to', p_new_due, 'reason', v_reason));
    perform public.notify_managers('approval_request', 'Deadline extension requested: ' || t.task_code,
      v_reason, 'task', t.id, '/tasks/' || t.id);
  end if;
  return x;
end $$;

create or replace function public.decide_deadline_extension(
  p_extension_id uuid, p_approve boolean, p_remarks text default null
) returns public.deadline_extensions
language plpgsql security definer set search_path = public as $$
declare x public.deadline_extensions; t public.tasks;
begin
  perform public.require_manager();
  select * into x from public.deadline_extensions where id = p_extension_id for update;
  if not found or x.status <> 'pending' then raise exception 'No pending extension found'; end if;
  if not p_approve and nullif(trim(coalesce(p_remarks, '')), '') is null then
    raise exception 'A reason is required when rejecting an extension';
  end if;
  update public.deadline_extensions set status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
         decided_by = auth.uid(), decided_at = now(), decision_remarks = p_remarks
   where id = x.id returning * into x;
  update public.approvals set status = x.status, decided_by = auth.uid(), decided_at = now(), remarks = coalesce(p_remarks, remarks)
   where extension_id = x.id and status = 'pending';
  select * into t from public.tasks where id = x.task_id;
  if p_approve then
    perform public.apply_deadline_extension(x.id);
    perform public.log_audit('task.extension_approved', 'task', t.id, t.task_code,
      jsonb_build_object('to', x.proposed_due_at, 'remarks', p_remarks));
  else
    perform public.log_audit('task.extension_rejected', 'task', t.id, t.task_code, jsonb_build_object('remarks', p_remarks));
  end if;
  perform public.notify(x.requested_by, 'extension_decision',
    'Extension ' || case when p_approve then 'approved' else 'rejected' end || ': ' || t.task_code,
    coalesce(p_remarks, ''), 'task', t.id, '/tasks/' || t.id);
  return x;
end $$;

-- ---------- Requirements ----------
create or replace function public.requirements_before() returns trigger
language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now(); new.updated_at := now();
    new.raised_at := least(coalesce(new.raised_at, now()), now());
    if public.is_api_role() then
      new.status := 'new';
      new.assigned_employee_id := null; new.task_id := null;
      new.reviewed_at := null; new.accepted_at := null; new.assigned_at := null;
      new.completed_at := null; new.closed_at := null; new.rejection_reason := null;
    end if;
    return new;
  end if;
  new.updated_at := now();
  new.req_code := old.req_code; new.raised_at := old.raised_at;     -- original submission date is permanent
  new.created_at := old.created_at; new.created_by := old.created_by;
  if public.is_api_role() then
    if new.status is distinct from old.status
       or new.assigned_employee_id is distinct from old.assigned_employee_id
       or new.task_id is distinct from old.task_id
       or new.rejection_reason is distinct from old.rejection_reason
       or new.clarification_remarks is distinct from old.clarification_remarks then
      raise exception 'Requirement status, owner and remarks change only through the requirement workflow';
    end if;
    new.reviewed_at := old.reviewed_at; new.accepted_at := old.accepted_at; new.assigned_at := old.assigned_at;
    new.completed_at := old.completed_at; new.closed_at := old.closed_at;
    if old.status in ('closed', 'rejected') then
      raise exception 'Closed or rejected requirements are read-only';
    end if;
  end if;
  return new;
end $$;

create or replace function public.requirements_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_remarks text := nullif(current_setting('app.remarks', true), '');
begin
  if TG_OP = 'INSERT' then
    insert into public.requirement_history(requirement_id, previous_status, new_status, remarks, changed_by)
    values (new.id, null, new.status, 'Requirement recorded', auth.uid());
    perform public.log_audit('requirement.created', 'requirement', new.id, new.req_code,
      jsonb_build_object('department', (select name from public.requesting_departments where id = new.department_id),
                         'requested_by', new.requested_by_name, 'type', new.requirement_type, 'priority', new.priority));
    perform public.notify_managers('new_requirement',
      'New ' || replace(new.requirement_type::text, '_', ' ') || ' requirement: ' || new.req_code,
      left(new.description, 140), 'requirement', new.id, '/requirements?open=' || new.id);
  elsif new.status is distinct from old.status then
    insert into public.requirement_history(requirement_id, previous_status, new_status, remarks, changed_by)
    values (new.id, old.status, new.status, v_remarks, auth.uid());
    perform public.log_audit('requirement.' || new.status::text, 'requirement', new.id, new.req_code,
      jsonb_build_object('from', old.status, 'to', new.status, 'remarks', v_remarks,
                         'assignee', public.employee_name(new.assigned_employee_id)));
  elsif new.assigned_employee_id is distinct from old.assigned_employee_id then
    perform public.log_audit('requirement.reassigned', 'requirement', new.id, new.req_code,
      jsonb_build_object('from', public.employee_name(old.assigned_employee_id), 'to', public.employee_name(new.assigned_employee_id)));
  end if;
  return new;
end $$;

create trigger requirements_before before insert or update on public.supply_requirements
  for each row execute function public.requirements_before();
create trigger requirements_after after insert or update on public.supply_requirements
  for each row execute function public.requirements_after();

create or replace function public.transition_requirement(
  p_requirement_id uuid, p_status public.requirement_status, p_remarks text default null
) returns public.supply_requirements
language plpgsql security definer set search_path = public as $$
declare r public.supply_requirements; v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
  v_allowed public.requirement_status[];
begin
  perform public.require_active_user();
  select * into r from public.supply_requirements where id = p_requirement_id for update;
  if not found then raise exception 'Requirement not found'; end if;
  if r.status = p_status then return r; end if;

  v_allowed := case r.status
    when 'new' then array['under_review', 'accepted', 'rejected', 'clarification_required']
    when 'under_review' then array['accepted', 'rejected', 'clarification_required']
    when 'clarification_required' then array['under_review', 'accepted', 'rejected']
    when 'accepted' then array['rejected', 'clarification_required']
    when 'assigned' then array['in_progress', 'clarification_required']
    when 'in_progress' then array['completed', 'clarification_required']
    when 'completed' then array['closed', 'in_progress']
    when 'rejected' then array['under_review']
    else array[]::text[] end::public.requirement_status[];
  if not (p_status = any(v_allowed)) then
    raise exception 'A requirement cannot move from % to %', r.status, p_status;
  end if;
  if p_status = 'assigned' then raise exception 'Use assign_requirement to assign an owner'; end if;
  if p_status in ('accepted', 'rejected', 'closed') or r.status = 'rejected' then
    perform public.require_manager();
  end if;
  if p_status = 'rejected' and v_remarks is null then
    raise exception 'A rejection reason is mandatory';
  end if;
  if p_status = 'clarification_required' and v_remarks is null then
    raise exception 'Document the clarification needed';
  end if;
  if r.assigned_employee_id is not null and not public.is_manager()
     and not public.can_access_employee(r.assigned_employee_id) then
    raise exception 'This requirement is assigned outside your scope' using errcode = '42501';
  end if;

  perform set_config('app.remarks', coalesce(v_remarks, ''), true);
  update public.supply_requirements set
    status = p_status,
    reviewed_at = case when p_status in ('under_review', 'accepted', 'rejected', 'clarification_required') then coalesce(reviewed_at, now()) else reviewed_at end,
    accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
    rejection_reason = case when p_status = 'rejected' then v_remarks else rejection_reason end,
    clarification_remarks = case when p_status = 'clarification_required'
      then concat_ws(E'\n', clarification_remarks, to_char(now() at time zone public.app_tz(), 'DD Mon YYYY HH24:MI') || ' — ' || v_remarks)
      else clarification_remarks end,
    completed_at = case when p_status = 'completed' then now() when p_status = 'in_progress' then null else completed_at end,
    completion_remarks = case when p_status = 'completed' then coalesce(v_remarks, completion_remarks) else completion_remarks end,
    closed_at = case when p_status = 'closed' then now() else closed_at end
  where id = r.id returning * into r;

  if p_status = 'clarification_required' then
    perform public.notify_managers('requirement_clarification', 'Clarification required: ' || r.req_code, v_remarks,
      'requirement', r.id, '/requirements?open=' || r.id);
  end if;
  return r;
end $$;

create or replace function public.assign_requirement(
  p_requirement_id uuid, p_employee uuid, p_category uuid default null,
  p_due timestamptz default null, p_create_task boolean default true, p_remarks text default null
) returns public.supply_requirements
language plpgsql security definer set search_path = public as $$
declare r public.supply_requirements; v_task uuid; v_due timestamptz;
begin
  perform public.require_active_user();
  if p_employee is null then raise exception 'No requirement can be assigned without an identified owner'; end if;
  if not public.can_access_employee(p_employee) then
    raise exception 'You can only assign within your scope' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and employment_status <> 'inactive') then
    raise exception 'Owner must be an active employee';
  end if;
  select * into r from public.supply_requirements where id = p_requirement_id for update;
  if not found then raise exception 'Requirement not found'; end if;
  if r.status not in ('accepted', 'assigned', 'in_progress') then
    raise exception 'Only accepted requirements can be assigned (current status: %)', r.status;
  end if;

  perform set_config('app.remarks', coalesce(nullif(trim(coalesce(p_remarks, '')), ''), 'Assigned to ' || public.employee_name(p_employee)), true);
  update public.supply_requirements set
    assigned_employee_id = p_employee,
    status = case when status = 'accepted' then 'assigned'::public.requirement_status else status end,
    assigned_at = coalesce(assigned_at, now())
  where id = r.id returning * into r;

  if r.task_id is null and p_create_task then
    if p_category is null then raise exception 'Choose a task category for the linked task'; end if;
    v_due := coalesce(p_due, case when r.required_by is not null
      then ((r.required_by::timestamp + time '18:00') at time zone public.app_tz()) end);
    insert into public.tasks(title, description, category_id, requirement_type, priority, owner_id,
                             status, start_date, due_at, destination, requirement_id, assigned_by)
    values (left(coalesce(r.product_name, 'Supply requirement') || ' — ' || r.req_code, 200),
            r.description, p_category, r.requirement_type, r.priority, p_employee,
            'assigned', current_date, v_due, r.destination, r.id, auth.uid())
    returning id into v_task;
    update public.supply_requirements set task_id = v_task where id = r.id returning * into r;
  elsif r.task_id is not null then
    perform public.reassign_task(r.task_id, p_employee, null, p_remarks);
  end if;
  return r;
end $$;

-- ---------- Costing ----------
create or replace function public.costing_before() returns trigger
language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now(); new.updated_at := now();
    if public.is_api_role() then
      new.status := 'draft'; new.approved_by := null; new.approved_at := null;
    end if;
    return new;
  end if;
  new.updated_at := now();
  new.costing_code := old.costing_code; new.created_at := old.created_at; new.created_by := old.created_by;
  if public.is_api_role() then
    if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception 'Costing status changes go through the validation workflow';
    end if;
    if old.status in ('approved', 'superseded') then
      raise exception 'Approved costing is locked. Create a revision to change it.';
    end if;
    if old.status = 'pending_approval' then
      raise exception 'Costing is awaiting approval. Withdraw it to draft before editing.';
    end if;
    new.supersedes_id := old.supersedes_id;
  end if;
  return new;
end $$;

create or replace function public.costing_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_fields text[] := '{}'; v_o jsonb := '{}'; v_n jsonb := '{}'; k text;
  v_remarks text := nullif(current_setting('app.remarks', true), '');
begin
  v_new := to_jsonb(new);
  if TG_OP = 'INSERT' then
    insert into public.costing_history(costing_id, action, new_values, remarks, changed_by)
    values (new.id, 'created', v_new, case when new.supersedes_id is not null then 'Revision created' end, auth.uid());
    perform public.log_audit('costing.created', 'costing', new.id, new.costing_code,
      jsonb_build_object('tour', new.tour_code, 'activity', new.activity_type));
    return new;
  end if;
  v_old := to_jsonb(old);
  for k in select jsonb_object_keys(v_new) loop
    if k not in ('updated_at') and (v_old -> k) is distinct from (v_new -> k) then
      v_fields := v_fields || k;
      v_o := v_o || jsonb_build_object(k, v_old -> k);
      v_n := v_n || jsonb_build_object(k, v_new -> k);
    end if;
  end loop;
  if array_length(v_fields, 1) is null then return new; end if;
  insert into public.costing_history(costing_id, action, changed_fields, old_values, new_values, remarks, changed_by)
  values (new.id, case when new.status is distinct from old.status then 'status:' || new.status::text else 'updated' end,
          v_fields, v_o, v_n, v_remarks, auth.uid());
  perform public.log_audit(
    case when new.status is distinct from old.status then
      case new.status when 'approved' then 'costing.approved' when 'rejected' then 'costing.rejected'
                      else 'costing.validation' end
    else 'costing.updated' end,
    'costing', new.id, new.costing_code, jsonb_build_object('fields', v_fields, 'from', v_o, 'to', v_n, 'remarks', v_remarks));
  return new;
end $$;

create trigger costing_before before insert or update on public.costing_records
  for each row execute function public.costing_before();
create trigger costing_after after insert or update on public.costing_records
  for each row execute function public.costing_after();

create or replace function public.can_access_costing(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or exists (
    select 1 from public.costing_records c where c.id = p_id
      and (c.created_by = auth.uid() or public.can_access_employee(c.assigned_employee_id)))
$$;

create or replace function public.set_costing_status(
  p_costing_id uuid, p_status public.costing_status, p_remarks text default null
) returns public.costing_records
language plpgsql security definer set search_path = public as $$
declare c public.costing_records;
begin
  perform public.require_active_user();
  if not public.can_access_costing(p_costing_id) then
    raise exception 'You do not have access to this costing record' using errcode = '42501';
  end if;
  if p_status in ('approved', 'rejected', 'superseded') then
    raise exception 'Approval decisions are made with decide_costing';
  end if;
  select * into c from public.costing_records where id = p_costing_id for update;
  if c.status in ('approved', 'superseded') then raise exception 'Approved costing is locked'; end if;
  if p_status = 'pending_approval' and (c.updated_cost is null or c.selling_price is null) then
    raise exception 'Updated supplier cost and selling price are required before submitting for approval';
  end if;
  perform set_config('app.remarks', coalesce(p_remarks, ''), true);
  update public.costing_records set status = p_status where id = c.id returning * into c;
  if p_status = 'pending_approval' then
    insert into public.approvals(kind, costing_id, requested_by, remarks) values ('costing', c.id, auth.uid(), p_remarks);
    perform public.notify_managers('approval_request', 'Costing approval requested: ' || c.costing_code,
      c.tour_code || ' · ' || c.tour_name, 'costing', c.id, '/costing?open=' || c.id);
  elsif c.status = 'pending_approval' then
    update public.approvals set status = 'rejected', decided_by = auth.uid(), decided_at = now(), remarks = 'Withdrawn'
     where costing_id = c.id and status = 'pending';
  end if;
  return c;
end $$;

create or replace function public.decide_costing(
  p_costing_id uuid, p_approve boolean, p_confirmation_reference text default null, p_remarks text default null
) returns public.costing_records
language plpgsql security definer set search_path = public as $$
declare c public.costing_records; v_ref text := nullif(trim(coalesce(p_confirmation_reference, '')), '');
begin
  perform public.require_manager();
  select * into c from public.costing_records where id = p_costing_id for update;
  if not found then raise exception 'Costing record not found'; end if;
  if c.status <> 'pending_approval' then raise exception 'Only costing pending approval can be decided'; end if;
  if p_approve and v_ref is null then
    raise exception 'A confirmation reference (supplier confirmation / contract / email ref) is required to approve costing';
  end if;
  if not p_approve and nullif(trim(coalesce(p_remarks, '')), '') is null then
    raise exception 'A reason is required when rejecting costing';
  end if;
  perform set_config('app.remarks', coalesce(p_remarks, ''), true);
  if p_approve then
    update public.costing_records set status = 'approved', confirmation_reference = v_ref,
           approved_by = auth.uid(), approved_at = now()
     where id = c.id returning * into c;
    if c.supersedes_id is not null then
      perform set_config('app.remarks', 'Superseded by ' || c.costing_code, true);
      update public.costing_records set status = 'superseded' where id = c.supersedes_id and status = 'approved';
    end if;
  else
    update public.costing_records set status = 'rejected' where id = c.id returning * into c;
  end if;
  update public.approvals set status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
         decided_by = auth.uid(), decided_at = now(), remarks = coalesce(p_remarks, v_ref)
   where costing_id = c.id and status = 'pending';
  perform public.notify(c.created_by, 'costing_decision',
    'Costing ' || case when p_approve then 'approved' else 'rejected' end || ': ' || c.costing_code,
    coalesce(p_remarks, v_ref), 'costing', c.id, '/costing?open=' || c.id);
  return c;
end $$;

create or replace function public.create_costing_revision(p_costing_id uuid, p_remarks text default null)
returns public.costing_records
language plpgsql security definer set search_path = public as $$
declare c public.costing_records; n public.costing_records;
begin
  perform public.require_active_user();
  if not public.can_access_costing(p_costing_id) then
    raise exception 'You do not have access to this costing record' using errcode = '42501';
  end if;
  select * into c from public.costing_records where id = p_costing_id;
  if c.status <> 'approved' then raise exception 'Revisions are created from approved costing'; end if;
  if exists (select 1 from public.costing_records where supersedes_id = c.id and status not in ('rejected', 'superseded')) then
    raise exception 'An open revision already exists for this costing';
  end if;
  insert into public.costing_records(tour_code, tour_name, destination, vendor_id, supplier_name, activity_type,
    existing_cost, updated_cost, currency, costing_basis, transfer_type, season, selling_price, effective_date,
    status, assigned_employee_id, supersedes_id, remarks, created_by)
  values (c.tour_code, c.tour_name, c.destination, c.vendor_id, c.supplier_name, 'cost_revision',
    c.updated_cost, c.updated_cost, c.currency, c.costing_basis, c.transfer_type, c.season, c.selling_price, null,
    'draft', c.assigned_employee_id, c.id, p_remarks, auth.uid())
  returning * into n;
  return n;
end $$;

-- ---------- Comments / attachments ----------
create or replace function public.comments_before_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := now();
  if public.is_api_role() then
    new.author_id := auth.uid();
    if new.kind = 'system' then raise exception 'System entries cannot be created manually'; end if;
  end if;
  return new;
end $$;
create trigger comments_before_insert before insert on public.task_comments for each row execute function public.comments_before_insert();

create or replace function public.comments_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if new.kind = 'supplier_response' then
    perform public.notify_task_stakeholders(t.id, 'supplier_response', 'Supplier response logged: ' || t.task_code, left(new.body, 140));
  elsif new.kind = 'blocker' then
    perform public.notify_task_stakeholders(t.id, 'blocker', 'Blocker reported: ' || t.task_code, left(new.body, 140), true);
  end if;
  return new;
end $$;
create trigger comments_after_insert after insert on public.task_comments for each row execute function public.comments_after_insert();

create or replace function public.attachments_before_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := now();
  if public.is_api_role() then new.uploaded_by := auth.uid(); end if;
  return new;
end $$;
create trigger attachments_before_insert before insert on public.task_attachments for each row execute function public.attachments_before_insert();

-- ---------- Master-data triggers ----------
create trigger employees_touch before update on public.employees for each row execute function public.touch_updated_at();
create trigger vendors_touch before update on public.vendors for each row execute function public.touch_updated_at();
create trigger employees_audit after insert or update on public.employees for each row execute function public.audit_row_change('employee');
create trigger vendors_audit after insert or update on public.vendors for each row execute function public.audit_row_change('vendor');
create trigger categories_audit after insert or update on public.task_categories for each row execute function public.audit_row_change('category');
create trigger profiles_audit after insert or update on public.profiles for each row execute function public.audit_row_change('user');
create trigger teams_audit after insert or update on public.teams for each row execute function public.audit_row_change('team');
create trigger settings_audit after insert or update on public.app_settings for each row execute function public.audit_row_change('setting');
create trigger recurring_audit after insert or update on public.recurring_tasks for each row execute function public.audit_row_change('recurring_task');

create or replace function public.employees_before_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.employee_code := upper(trim(new.employee_code));
  return new;
end $$;
create trigger employees_before_insert before insert on public.employees for each row execute function public.employees_before_insert();

-- ---------- Deadline monitor (pg_cron / Vercel cron) ----------
create or replace function public.task_deadline_state(
  p_status public.task_status, p_priority public.task_priority, p_due timestamptz
) returns text
language sql stable as $$
  select case
    when p_status in ('completed', 'cancelled') then 'closed'
    when p_status = 'awaiting_review' then 'submitted'
    when p_due is null then 'no_deadline'
    when now() > p_due and p_priority = 'critical' then 'escalated'
    when now() > p_due then 'overdue'
    when p_due - now() <= interval '3 hours' then 'due_shortly'
    when p_due - now() <= interval '24 hours' then 'upcoming'
    else 'on_track' end
$$;

create or replace function public.run_deadline_monitor() returns integer
language plpgsql security definer set search_path = public as $$
declare t record; v_level text; v_count int := 0; v_rank jsonb := '{"upcoming":1,"due_shortly":2,"overdue":3,"escalated":4}';
  r record;
begin
  for t in
    select * from public.tasks
     where status not in ('completed', 'cancelled', 'awaiting_review') and due_at is not null
       and due_at - now() <= interval '24 hours'
  loop
    v_level := public.task_deadline_state(t.status, t.priority, t.due_at);
    if v_level not in ('upcoming', 'due_shortly', 'overdue', 'escalated') then continue; end if;
    if coalesce((v_rank ->> t.deadline_alert_level)::int, 0) >= (v_rank ->> v_level)::int then continue; end if;

    update public.tasks set deadline_alert_level = v_level,
           is_escalated = (v_level = 'escalated') or is_escalated,
           escalated_at = case when v_level = 'escalated' then now() else escalated_at end
     where id = t.id;

    if v_level = 'escalated' then
      perform public.notify_managers('critical_escalation', 'ESCALATION — critical task overdue: ' || t.task_code,
        t.title || ' (owner: ' || coalesce(public.employee_name(t.owner_id), '—') || ')', 'task', t.id, '/tasks/' || t.id, true);
      perform public.notify_task_stakeholders(t.id, 'critical_escalation', 'Critical task overdue: ' || t.task_code, t.title);
      perform public.log_audit('task.escalated', 'task', t.id, t.task_code, jsonb_build_object('due_at', t.due_at));
    elsif v_level = 'overdue' then
      perform public.notify_task_stakeholders(t.id, 'overdue', 'Overdue: ' || t.task_code, t.title, t.priority = 'high');
    elsif v_level = 'due_shortly' then
      perform public.notify_task_stakeholders(t.id, 'due_shortly', 'Due within 3 hours: ' || t.task_code, t.title);
    else
      perform public.notify_task_stakeholders(t.id, 'upcoming_deadline', 'Due within 24 hours: ' || t.task_code, t.title);
    end if;
    v_count := v_count + 1;
  end loop;

  -- supplier follow-up reminder: pending supplier response for >24h, at most once per day per task
  for t in
    select tk.* from public.tasks tk
     where tk.status = 'pending_supplier'
       and (select max(h.changed_at) from public.task_history h where h.task_id = tk.id and h.field = 'status') < now() - interval '24 hours'
       and not exists (select 1 from public.notifications n where n.entity_id = tk.id and n.type = 'pending_supplier'
                         and n.created_at > now() - interval '24 hours')
  loop
    perform public.notify_task_stakeholders(t.id, 'pending_supplier', 'Supplier response still pending: ' || t.task_code, t.title);
    v_count := v_count + 1;
  end loop;

  -- requirements past their required date, once per day
  for r in
    select * from public.supply_requirements q
     where q.status not in ('completed', 'closed', 'rejected') and q.required_by < (now() at time zone public.app_tz())::date
       and not exists (select 1 from public.notifications n where n.entity_id = q.id and n.type = 'requirement_delayed'
                         and n.created_at > now() - interval '24 hours')
  loop
    perform public.notify_managers('requirement_delayed', 'Requirement past due: ' || r.req_code,
      left(r.description, 140), 'requirement', r.id, '/requirements?open=' || r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.generate_recurring_tasks() returns integer
language plpgsql security definer set search_path = public as $$
declare rt public.recurring_tasks; v_count int := 0; v_today date := (now() at time zone public.app_tz())::date; v_next date;
begin
  for rt in select * from public.recurring_tasks where is_active and next_run_on <= v_today for update loop
    if exists (select 1 from public.employees where id = rt.owner_id and employment_status <> 'inactive') then
      insert into public.tasks(title, description, category_id, requirement_type, priority, owner_id, status,
                               start_date, due_at, estimated_hours, recurring_task_id, assigned_by)
      values (rt.title, rt.description, rt.category_id, rt.requirement_type, rt.priority, rt.owner_id, 'assigned',
              v_today, (v_today::timestamp + rt.due_time) at time zone public.app_tz(), rt.estimated_hours, rt.id, rt.created_by);
      v_count := v_count + 1;
    end if;
    v_next := rt.next_run_on;
    while v_next <= v_today loop
      v_next := case rt.frequency when 'daily' then v_next + 1 when 'weekly' then v_next + 7
                                  else (v_next + interval '1 month')::date end;
    end loop;
    update public.recurring_tasks set next_run_on = v_next where id = rt.id;
  end loop;
  return v_count;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
   where recipient_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;
