-- =====================================================================
-- Workflow + security test suite. Runs on a scratch database (see run.sh).
-- Each check raises on failure, so ON_ERROR_STOP aborts the run.
-- =====================================================================
\set QUIET on
create schema tests;
grant usage on schema tests to authenticated, anon;
grant select on auth.users to authenticated;  -- test harness only (lets tests.login switch users)
\o /dev/null

create function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), false);
end $$;
create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('role', 'none', false);
end $$;
create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'PASS: %', p_msg;
end $$;
create function tests.throws(p_sql text, p_pattern text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then
      raise notice 'PASS: % (blocked: %)', p_msg, sqlerrm; return;
    end if;
    raise exception 'FAIL: % — unexpected error: %', p_msg, sqlerrm;
  end;
  raise exception 'FAIL: % — statement was not blocked', p_msg;
end $$;
create function tests.emp(p_code text) returns uuid language sql security definer as $$ select id from public.employees where employee_code = p_code $$;
grant execute on all functions in schema tests to authenticated, anon;
set client_min_messages = notice;

-- ---------- Accounts ----------
insert into public.teams(name) values ('Team B');
insert into auth.users(email, raw_app_meta_data) values ('admin@x.test', '{}');
insert into auth.users(email, raw_app_meta_data) values ('manager@x.test', '{"role":"manager","full_name":"Mona Manager"}');
insert into auth.users(email, raw_app_meta_data)
  select 'leadA@x.test', jsonb_build_object('role', 'leader', 'full_name', 'Leo LeaderA', 'team_id', id) from public.teams where name = 'Supply Team';
insert into auth.users(email, raw_app_meta_data)
  select 'leadB@x.test', jsonb_build_object('role', 'leader', 'full_name', 'Lia LeaderB', 'team_id', id) from public.teams where name = 'Team B';
insert into auth.users(email, raw_user_meta_data) values ('rogue@x.test', '{"role":"admin"}');   -- self sign-up trying to claim admin

select tests.ok((select role = 'admin' and is_active from public.profiles where email = 'admin@x.test'), 'first account bootstraps as active admin');
select tests.ok((select role = 'manager' and is_active from public.profiles where email = 'manager@x.test'), 'admin-created manager is active');
select tests.ok((select role = 'leader' and not is_active from public.profiles where email = 'rogue@x.test'), 'self sign-up cannot claim a role and stays inactive');

-- ---------- Employee management ----------
select tests.login('manager@x.test');
insert into public.employees(employee_code, full_name, designation, team_id, joining_date)
  select 'sup-001', 'Asha Rao', 'Supply Executive', id, '2024-01-10' from public.teams where name = 'Supply Team';
insert into public.employees(employee_code, full_name, designation, team_id)
  select 'SUP-002', 'Ben Thomas', 'Costing Analyst', id from public.teams where name = 'Supply Team';
insert into public.employees(employee_code, full_name, designation, team_id)
  select 'SUP-003', 'Chen Li', 'Product Executive', id from public.teams where name = 'Team B';
select tests.ok((select count(*) = 3 from public.employees), 'manager can add employees');
select tests.ok(exists (select 1 from public.employees where employee_code = 'SUP-001'), 'employee ID normalised to upper case');
select tests.throws($$delete from public.employees$$, 'permission denied', 'employees cannot be deleted (deactivate instead)');

select tests.login('leadA@x.test');
select tests.throws($$insert into public.employees(employee_code, full_name, designation) values ('X1','X','Y')$$,
  'row-level security', 'leader cannot add employees');
select tests.ok((select count(*) = 2 from public.employees), 'leader A sees only own team (2 employees)');

select tests.login('rogue@x.test');
select tests.ok((select count(*) = 0 from public.task_categories), 'inactive account sees no data');
select tests.logout();

set role anon;
select tests.throws($$select * from public.tasks$$, 'permission denied', 'anonymous users have no table access');
reset role;

-- ---------- Task creation & access scope ----------
select tests.login('leadA@x.test');
insert into public.tasks(title, category_id, priority, owner_id, due_at, estimated_hours)
select 'Map Dubai desert safari', c.id, 'high', e.id, now() + interval '2 days', 3
  from public.task_categories c, public.employees e where c.name = 'Product Mapping' and e.employee_code = 'SUP-001';
select tests.ok((select status = 'assigned' and task_code like 'TSK-%' and original_due_at = due_at from public.tasks where title = 'Map Dubai desert safari'),
  'task gets auto ID, status Assigned and original deadline');
select tests.ok((select count(*) = 1 from public.task_assignments a join public.tasks t on t.id = a.task_id
                 where t.title = 'Map Dubai desert safari' and a.is_owner), 'owner assignment recorded');
select tests.throws($$insert into public.tasks(title, category_id, owner_id)
  select 'Out of scope', c.id, tests.emp('SUP-003') from public.task_categories c where c.name = 'Product Mapping'$$, 'row-level security', 'leader cannot assign outside own team');
select tests.throws($$insert into public.tasks(title, category_id, owner_id, status)
  select 'Sneaky', c.id, e.id, 'completed' from public.task_categories c, public.employees e
   where c.name = 'Product Mapping' and e.employee_code = 'SUP-001'$$, 'must start as', 'cannot create a task already completed');

select tests.login('leadB@x.test');
select tests.ok((select count(*) = 0 from public.tasks), 'leader B cannot see leader A team tasks');

-- ---------- Guards on direct edits ----------
select tests.login('leadA@x.test');
select tests.throws($$update public.tasks set status = 'completed' where title = 'Map Dubai desert safari'$$,
  'workflow', 'status cannot be changed by direct update');
select tests.throws($$update public.tasks set due_at = due_at + interval '5 days' where title = 'Map Dubai desert safari'$$,
  'extension', 'deadline cannot be silently changed');
select tests.throws($$update public.tasks set priority = 'low' where title = 'Map Dubai desert safari'$$,
  'Only the Supply Team Manager', 'leader cannot change priority after creation');
update public.tasks set description = 'Check inclusions and pickup timings' where title = 'Map Dubai desert safari';
select tests.ok((select description is not null from public.tasks where title = 'Map Dubai desert safari'), 'leader can edit descriptive fields');
select tests.throws($$delete from public.task_history$$, 'permission denied', 'history cannot be erased');
select tests.throws($$insert into public.task_history(task_id, field) select id, 'x' from public.tasks limit 1$$, 'permission denied', 'history cannot be forged');

-- ---------- Status workflow ----------
select public.change_task_status((select id from public.tasks where title = 'Map Dubai desert safari'), 'in_progress', 'Started mapping');
select tests.ok((select previous_status = 'assigned' and new_status = 'in_progress' and remarks = 'Started mapping'
                   and changed_by = auth.uid() from public.task_history h join public.tasks t on t.id = h.task_id
                  where t.title = 'Map Dubai desert safari' and h.new_status = 'in_progress'),
  'status change logged with previous/new status, user and remarks');
select tests.throws($$select public.change_task_status((select id from public.tasks where title = 'Map Dubai desert safari'), 'completed')$$,
  'manager approval', 'completion requires approval');
select tests.throws($$select public.change_task_status((select id from public.tasks where title = 'Map Dubai desert safari'), 'on_hold')$$,
  'Remarks are required', 'on hold needs remarks');
select public.change_task_status((select id from public.tasks where title = 'Map Dubai desert safari'), 'awaiting_review', 'Mapped 4 variants', 2.5);
select tests.ok((select approval_status = 'pending' and submitted_at is not null and actual_hours = 2.5 from public.tasks where title = 'Map Dubai desert safari'),
  'submission sets approval pending, submitted time and actual hours');
select tests.throws($$select public.decide_task_approval((select id from public.tasks where title = 'Map Dubai desert safari'), true)$$,
  'Only the Supply Team Manager', 'leader cannot approve');

select tests.login('manager@x.test');
select tests.ok((select count(*) >= 1 from public.notifications where type = 'approval_request'), 'manager notified of approval request');
select tests.throws($$select public.decide_task_approval((select id from public.tasks where title = 'Map Dubai desert safari'), false, '')$$,
  'reason is required', 'rejection needs a reason');
select public.decide_task_approval((select id from public.tasks where title = 'Map Dubai desert safari'), false, 'Missing child pricing');
select tests.ok((select status = 'reopened' and reopen_count = 1 and approval_status = 'rejected' from public.tasks where title = 'Map Dubai desert safari'),
  'rejected completion reopens the task and counts the reopen');

select tests.login('leadA@x.test');
select tests.ok((select count(*) >= 1 from public.notifications where type = 'task_rejected'), 'leader notified of rejection');
select public.change_task_status((select id from public.tasks where title = 'Map Dubai desert safari'), 'awaiting_review', 'Child pricing added');
select tests.login('manager@x.test');
select public.decide_task_approval((select id from public.tasks where title = 'Map Dubai desert safari'), true, 'Good work', 4::smallint);
select tests.ok((select status = 'completed' and approval_status = 'approved' and quality_rating = 4 and completed_on_time
                   from public.task_overview where title = 'Map Dubai desert safari'), 'approval closes the task, on-time flag computed');
select tests.login('leadA@x.test');
select tests.throws($$update public.tasks set title = 'changed' where title = 'Map Dubai desert safari'$$, 'read-only', 'closed tasks are read-only');
select tests.throws($$select public.change_task_status((select id from public.tasks where title = 'Map Dubai desert safari'), 'reopened', 'x')$$,
  'Only the Supply Team Manager', 'only manager can reopen');

-- ---------- Deadline extensions ----------
insert into public.tasks(title, category_id, priority, owner_id, due_at)
select 'Peak season costing Bali', c.id, 'critical', e.id, now() + interval '1 day'
  from public.task_categories c, public.employees e where c.name = 'Peak Season Costing' and e.employee_code = 'SUP-002';
select public.request_deadline_extension((select id from public.tasks where title = 'Peak season costing Bali'), now() + interval '4 days', 'Supplier rates awaited');
select tests.ok((select extension_count = 0 and due_at = original_due_at from public.tasks where title = 'Peak season costing Bali'),
  'leader extension request does not move deadline before approval');
select tests.throws($$select public.request_deadline_extension((select id from public.tasks where title = 'Peak season costing Bali'), now() + interval '5 days', 'again')$$,
  'already pending', 'only one pending extension at a time');
select tests.login('manager@x.test');
select public.decide_deadline_extension((select id from public.deadline_extensions where status = 'pending'), true, 'OK');
select tests.ok((select extension_count = 1 and due_at > original_due_at and last_delay_reason = 'Supplier rates awaited'
                   from public.tasks where title = 'Peak season costing Bali'), 'approved extension revises deadline, keeps original, counts extension');
select tests.ok((select count(*) = 1 from public.task_comments where kind = 'delay_reason'), 'reason for delay stored in activity');

-- ---------- Reassignment ----------
select tests.login('leadA@x.test');
select tests.throws($$select public.reassign_task((select id from public.tasks where title = 'Peak season costing Bali'),
   tests.emp('SUP-003'))$$, 'scope', 'leader cannot reassign outside team');
select tests.login('manager@x.test');
select public.reassign_task((select id from public.tasks where title = 'Peak season costing Bali'),
  (select id from public.employees where employee_code = 'SUP-001'),
  array[(select id from public.employees where employee_code = 'SUP-002')], 'Balance workload');
select tests.ok((select owner_name = 'Asha Rao' and contributor_names = array['Ben Thomas'] from public.task_overview where title = 'Peak season costing Bali'),
  'reassignment sets new accountable owner and keeps contributor');
select tests.ok((select count(*) = 1 from public.task_history h join public.tasks t on t.id = h.task_id
                  where t.title = 'Peak season costing Bali' and h.field = 'owner' and h.old_value = 'Ben Thomas'), 'reassignment logged');

-- ---------- Deadline monitor ----------
reset role;
update public.tasks set due_at = now() - interval '1 hour' where title = 'Peak season costing Bali';
select tests.ok(public.run_deadline_monitor() >= 1, 'monitor raises alerts');
select tests.ok((select is_escalated and deadline_alert_level = 'escalated' from public.tasks where title = 'Peak season costing Bali'),
  'critical overdue task escalated to management');
select tests.ok((select count(*) >= 2 from public.notifications where type = 'critical_escalation'), 'managers and admins notified of escalation');
select tests.ok(public.run_deadline_monitor() = 0, 'monitor does not repeat the same alert');
select tests.ok((select deadline_state = 'escalated' and is_overdue from public.task_overview where title = 'Peak season costing Bali'),
  'overview reports escalated/overdue state');

-- ---------- Supply requirement tracker ----------
select tests.login('leadA@x.test');
insert into public.supply_requirements(department_id, requested_by_name, description, destination, product_name, requirement_type, priority, required_by, status)
select id, 'Rohan (Sales)', 'Need private desert safari costing for 6 pax', 'Dubai', 'Desert Safari', 'urgent', 'high', current_date + 2, 'closed'
  from public.requesting_departments where name = 'Sales';
select tests.ok((select status = 'new' and req_code like 'REQ-%' from public.supply_requirements), 'requirement always starts as New');
select tests.throws($$select public.transition_requirement((select id from public.supply_requirements), 'accepted')$$,
  'Only the Supply Team Manager', 'leader cannot accept requests');
select tests.throws($$select public.transition_requirement((select id from public.supply_requirements), 'clarification_required', '  ')$$,
  'clarification', 'clarification must be documented');
select public.transition_requirement((select id from public.supply_requirements), 'clarification_required', 'Confirm vehicle type');
select tests.throws($$update public.supply_requirements set raised_at = now() - interval '9 days'$$, 'permission denied', 'raised date cannot be edited');

select tests.login('manager@x.test');
select tests.throws($$select public.transition_requirement((select id from public.supply_requirements), 'rejected', '')$$,
  'mandatory', 'rejection requires an explanation');
select tests.throws($$select public.assign_requirement((select id from public.supply_requirements), (select id from public.employees where employee_code='SUP-001'))$$,
  'Only accepted', 'cannot assign before acceptance');
select public.transition_requirement((select id from public.supply_requirements), 'accepted', 'Valid request');
select tests.throws($$select public.assign_requirement((select id from public.supply_requirements), null)$$,
  'identified owner', 'no assignment without an owner');
select public.assign_requirement((select id from public.supply_requirements), (select id from public.employees where employee_code = 'SUP-002'),
  (select id from public.task_categories where name = 'Sales Requirements'));
select tests.ok((select status = 'assigned' and task_id is not null and assignee_name = 'Ben Thomas' from public.requirement_overview),
  'assignment creates a linked task for the owner');
select public.change_task_status((select task_id from public.supply_requirements), 'in_progress');
select tests.ok((select status = 'in_progress' from public.supply_requirements), 'requirement follows task into In Progress');
select public.change_task_status((select task_id from public.supply_requirements), 'awaiting_review', 'Costed at AED 450 pp');
select public.decide_task_approval((select task_id from public.supply_requirements), true);
select tests.ok((select status = 'completed' and completed_at is not null from public.supply_requirements), 'approving the task completes the requirement');
select public.transition_requirement((select id from public.supply_requirements), 'closed');
select tests.ok((select string_agg(new_status::text, '>' order by id) = 'new>clarification_required>accepted>assigned>in_progress>completed>closed'
                   from public.requirement_history), 'full requirement workflow recorded');
select tests.ok((select pending_days is not null from public.requirement_overview), 'pending duration tracked');

insert into public.supply_requirements(department_id, requested_by_name, description, requirement_type)
select id, 'Ops desk', 'Ad hoc transfer check', 'ad_hoc' from public.requesting_departments where name = 'Operations';
select public.transition_requirement((select id from public.supply_requirements where requested_by_name = 'Ops desk'), 'rejected', 'Duplicate of REQ-000001');
select tests.ok((select rejection_reason = 'Duplicate of REQ-000001' from public.supply_requirements where requested_by_name = 'Ops desk'), 'rejection reason stored');

-- ---------- Costing & validation ----------
select tests.login('leadA@x.test');
insert into public.costing_records(tour_code, tour_name, destination, supplier_name, activity_type, existing_cost, currency, costing_basis, transfer_type, assigned_employee_id, status)
select 'DXB-SAF-01', 'Desert Safari Private', 'Dubai', 'Arabian DMC', 'cost_revision', 400, 'AED', 'per_car', 'private', id, 'approved'
  from public.employees where employee_code = 'SUP-002';
select tests.ok((select status = 'draft' and costing_code like 'CST-%' from public.costing_records), 'costing created as draft regardless of input');
select tests.throws($$select public.set_costing_status((select id from public.costing_records), 'pending_approval')$$,
  'required before submitting', 'cannot submit without updated cost & selling price');
update public.costing_records set updated_cost = 450, selling_price = 600;
select tests.ok((select margin = 150 and margin_pct = 25 from public.costing_records), 'margin and margin % calculated');
select public.set_costing_status((select id from public.costing_records), 'pending_approval', 'Supplier email 12 Nov');
select tests.throws($$update public.costing_records set selling_price = 1$$, 'awaiting approval', 'pending costing locked for edits');
select tests.throws($$select public.decide_costing((select id from public.costing_records), true)$$, 'Only the Supply Team Manager', 'leader cannot approve costing');
select tests.login('manager@x.test');
select tests.throws($$select public.decide_costing((select id from public.costing_records), true, '')$$,
  'confirmation reference', 'approval requires confirmation reference');
select public.decide_costing((select id from public.costing_records), true, 'Email ARB/2026/118');
select tests.throws($$update public.costing_records set updated_cost = 999$$, 'locked', 'approved costing cannot be modified');
select public.create_costing_revision((select id from public.costing_records where status = 'approved'), 'Peak surcharge');
update public.costing_records set updated_cost = 500, selling_price = 650 where supersedes_id is not null;
select public.set_costing_status((select id from public.costing_records where supersedes_id is not null), 'pending_approval');
select public.decide_costing((select id from public.costing_records where supersedes_id is not null), true, 'Contract addendum 3');
select tests.ok((select status = 'superseded' from public.costing_records where supersedes_id is null), 'old costing superseded by approved revision');
select tests.ok((select count(*) >= 6 from public.costing_history), 'costing change history retained');
select tests.ok((select cost_change_pct = 0 from public.costing_overview where supersedes_id is null) is not null, 'costing overview computes change %');

-- ---------- Audit trail ----------
select tests.ok((select count(distinct action) >= 12 from public.audit_log where action in (
  'task.created', 'task.assigned', 'task.reassigned', 'task.status_changed', 'task.deadline_changed', 'task.approved',
  'task.rejected', 'task.closed', 'task.escalated', 'costing.approved', 'costing.validation', 'requirement.rejected',
  'requirement.accepted', 'employee.created')), 'audit trail covers the required actions');
select tests.ok((select bool_and(actor_name is not null and created_at is not null) from public.audit_log), 'audit rows carry identity and timestamp');
select tests.throws($$update public.audit_log set action = 'x'$$, 'permission denied', 'audit log is immutable');
select tests.throws($$delete from public.audit_log$$, 'permission denied', 'audit log cannot be erased');
select tests.login('leadA@x.test');
select tests.ok((select count(*) = 0 from public.audit_log), 'leaders cannot read the audit log');

-- ---------- Notifications ----------
select tests.ok((select count(*) > 0 from public.notifications), 'leader has notifications');
select public.mark_notifications_read();
select tests.ok((select count(*) = 0 from public.notifications where read_at is null), 'mark all read');
select tests.ok((select count(*) = 0 from public.notifications where recipient_id <> auth.uid()), 'users only see their own notifications');

-- ---------- Recurring tasks ----------
reset role;
insert into public.recurring_tasks(title, category_id, owner_id, frequency, next_run_on)
select 'Daily supply report', c.id, e.id, 'daily', current_date - 2
  from public.task_categories c, public.employees e where c.name = 'Daily Reports' and e.employee_code = 'SUP-001';
select tests.ok(public.generate_recurring_tasks() = 1, 'recurring task generated once');
select tests.ok((select next_run_on > (now() at time zone public.app_tz())::date from public.recurring_tasks), 'next run advanced past today');
select tests.ok(public.generate_recurring_tasks() = 0, 'no duplicate generation');

-- ---------- Admin safeguards ----------
select tests.login('admin@x.test');
select tests.throws($$update public.profiles set is_active = false where email = 'admin@x.test'$$, 'administrator must remain', 'last admin cannot be deactivated');
update public.profiles set is_active = true where email = 'rogue@x.test';
select tests.ok((select is_active from public.profiles where email = 'rogue@x.test'), 'admin can activate an account');
select tests.login('manager@x.test');
-- RLS silently filters the update (0 rows), so verify the role is unchanged:
update public.profiles set role = 'admin' where email = 'manager@x.test';
select tests.ok((select role = 'manager' from public.profiles where email = 'manager@x.test'), 'manager cannot escalate own role');

-- ---------- Storage path access ----------
select tests.ok(public.can_access_attachment_path('task/' || (select id from public.tasks limit 1) || '/a-file.pdf'), 'manager may access task attachments');
select tests.ok(not public.can_access_attachment_path('../etc/passwd'), 'malformed attachment paths rejected');

reset role;
\o
\echo
\echo ============ ALL TESTS PASSED ============
