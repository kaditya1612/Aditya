-- =====================================================================
-- Supply Team Portal — Phase 1: core schema
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Enums (workflow states only; extensible lists are tables) ----------
create type public.app_role as enum ('admin', 'manager', 'leader');

create type public.task_status as enum (
  'new', 'not_started', 'assigned', 'in_progress',
  'pending_supplier', 'pending_clarification', 'on_hold',
  'awaiting_review', 'completed', 'reopened', 'cancelled'
);

create type public.task_priority as enum ('critical', 'high', 'medium', 'low');
create type public.requirement_type as enum ('urgent', 'ad_hoc', 'standard');
create type public.approval_status as enum ('not_required', 'pending', 'approved', 'rejected');
create type public.employment_status as enum ('active', 'on_leave', 'inactive');

create type public.requirement_status as enum (
  'new', 'under_review', 'accepted', 'rejected', 'clarification_required',
  'assigned', 'in_progress', 'completed', 'closed'
);

create type public.costing_status as enum (
  'draft', 'in_validation', 'pending_supplier', 'pending_approval',
  'approved', 'rejected', 'superseded'
);
create type public.costing_basis as enum ('per_person', 'per_car', 'per_group');
create type public.costing_activity as enum (
  'new_costing', 'cost_revision', 'price_discrepancy', 'pax_vs_car_validation',
  'private_vs_sic_validation', 'seasonal_pricing', 'selling_price_validation', 'margin_impact'
);

create type public.comment_kind as enum (
  'remark', 'progress', 'blocker', 'completion_note', 'supplier_response', 'delay_reason', 'system'
);

-- ---------- Organisation ----------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  leader_id uuid,                      -- fk added after profiles
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'leader',
  team_id uuid references public.teams(id),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teams
  add constraint teams_leader_fk foreign key (leader_id) references public.profiles(id) on delete set null;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  full_name text not null,
  email text,
  phone text,
  designation text not null,
  team_id uuid references public.teams(id),
  reporting_manager_id uuid references public.profiles(id),
  joining_date date,
  employment_status public.employment_status not null default 'active',
  daily_capacity_hours numeric(4,1) not null default 8 check (daily_capacity_hours > 0 and daily_capacity_hours <= 24),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employees_team_idx on public.employees(team_id);

-- ---------- Lookups ----------
create table public.task_category_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  sort_order int not null default 0
);

create table public.task_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.task_category_groups(id),
  name text not null,
  default_effort_hours numeric(5,1),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create table public.requesting_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_code text unique,
  name text not null,
  vendor_type text not null default 'DMC' check (vendor_type in ('DMC', 'Supplier', 'Transfer', 'Hotel', 'Activity', 'Other')),
  destination text,
  country text,
  contact_name text,
  contact_email text,
  contact_phone text,
  is_active boolean not null default true,
  performance_rating smallint check (performance_rating between 1 and 5),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Requirements ----------
create sequence public.requirement_code_seq;

create table public.supply_requirements (
  id uuid primary key default gen_random_uuid(),
  req_code text not null unique default ('REQ-' || lpad(nextval('public.requirement_code_seq')::text, 6, '0')),
  department_id uuid not null references public.requesting_departments(id),
  requested_by_name text not null,
  description text not null check (length(trim(description)) > 0),
  destination text,
  product_name text,
  requirement_type public.requirement_type not null default 'standard',
  priority public.task_priority not null default 'medium',
  raised_at timestamptz not null default now(),
  required_by date,
  assigned_employee_id uuid references public.employees(id),
  status public.requirement_status not null default 'new',
  clarification_remarks text,
  rejection_reason text,
  completion_remarks text,
  reviewed_at timestamptz,
  accepted_at timestamptz,
  assigned_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  task_id uuid,                        -- fk added after tasks
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint req_owner_required check (
    status not in ('assigned', 'in_progress', 'completed', 'closed') or assigned_employee_id is not null
  ),
  constraint req_rejection_reason check (
    status <> 'rejected' or length(trim(coalesce(rejection_reason, ''))) > 0
  )
);
create index supply_requirements_status_idx on public.supply_requirements(status);

-- ---------- Recurring task templates ----------
create table public.recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid not null references public.task_categories(id),
  owner_id uuid not null references public.employees(id),
  priority public.task_priority not null default 'medium',
  requirement_type public.requirement_type not null default 'standard',
  estimated_hours numeric(6,2),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday smallint check (weekday between 1 and 7),       -- ISO: 1 = Monday
  day_of_month smallint check (day_of_month between 1 and 28),
  due_time time not null default '18:00',
  next_run_on date not null default current_date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- Tasks ----------
create sequence public.task_code_seq;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique default ('TSK-' || lpad(nextval('public.task_code_seq')::text, 6, '0')),
  title text not null check (length(trim(title)) > 0),
  description text,
  category_id uuid not null references public.task_categories(id),
  requirement_type public.requirement_type not null default 'standard',
  priority public.task_priority not null default 'medium',
  assigned_by uuid references public.profiles(id),
  owner_id uuid references public.employees(id),
  status public.task_status not null default 'new',
  start_date date,
  due_at timestamptz,
  original_due_at timestamptz,
  extension_count int not null default 0,
  last_delay_reason text,
  estimated_hours numeric(6,2) check (estimated_hours is null or estimated_hours >= 0),
  actual_hours numeric(6,2) check (actual_hours is null or actual_hours >= 0),
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  completion_remarks text,
  approval_status public.approval_status not null default 'not_required',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  quality_rating smallint check (quality_rating between 1 and 5),
  reopen_count int not null default 0,
  is_escalated boolean not null default false,
  escalated_at timestamptz,
  deadline_alert_level text,          -- last alert sent by the deadline monitor
  destination text,
  requirement_id uuid references public.supply_requirements(id),
  vendor_id uuid references public.vendors(id),
  recurring_task_id uuid references public.recurring_tasks(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_assigned_needs_owner check (
    status in ('new', 'not_started', 'cancelled') or owner_id is not null
  )
);
create index tasks_owner_idx on public.tasks(owner_id);
create index tasks_status_idx on public.tasks(status);
create index tasks_due_idx on public.tasks(due_at);
create index tasks_category_idx on public.tasks(category_id);
create index tasks_created_idx on public.tasks(created_at);

alter table public.supply_requirements
  add constraint supply_requirements_task_fk foreign key (task_id) references public.tasks(id) on delete set null;

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  is_owner boolean not null default false,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);
create index task_assignments_task_idx on public.task_assignments(task_id);
create index task_assignments_emp_idx on public.task_assignments(employee_id);
create unique index task_assignments_active_uniq on public.task_assignments(task_id, employee_id) where unassigned_at is null;

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.profiles(id),
  kind public.comment_kind not null default 'remark',
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments(task_id, created_at);

create table public.task_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  field text not null,                 -- 'status', 'priority', 'owner_id', 'due_at', ...
  previous_status public.task_status,
  new_status public.task_status,
  old_value text,
  new_value text,
  remarks text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index task_history_task_idx on public.task_history(task_id, changed_at);

create table public.deadline_extensions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  old_due_at timestamptz,
  proposed_due_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  status public.approval_status not null default 'pending',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_remarks text
);
create index deadline_extensions_task_idx on public.deadline_extensions(task_id);

-- ---------- Costing ----------
create sequence public.costing_code_seq;

create table public.costing_records (
  id uuid primary key default gen_random_uuid(),
  costing_code text not null unique default ('CST-' || lpad(nextval('public.costing_code_seq')::text, 6, '0')),
  tour_code text not null,
  tour_name text not null,
  destination text,
  vendor_id uuid references public.vendors(id),
  supplier_name text,
  activity_type public.costing_activity not null default 'new_costing',
  existing_cost numeric(14,2) check (existing_cost is null or existing_cost >= 0),
  updated_cost numeric(14,2) check (updated_cost is null or updated_cost >= 0),
  currency char(3) not null default 'INR',
  costing_basis public.costing_basis not null default 'per_person',
  transfer_type text check (transfer_type in ('private', 'sic')),
  season text,
  selling_price numeric(14,2) check (selling_price is null or selling_price >= 0),
  margin numeric(14,2) generated always as (selling_price - updated_cost) stored,
  margin_pct numeric(7,2) generated always as (
    case when selling_price > 0 and updated_cost is not null
      then round(((selling_price - updated_cost) / selling_price) * 100, 2) end
  ) stored,
  effective_date date,
  status public.costing_status not null default 'draft',
  assigned_employee_id uuid references public.employees(id),
  task_id uuid references public.tasks(id) on delete set null,
  supersedes_id uuid references public.costing_records(id),
  confirmation_reference text,
  remarks text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint costing_approved_needs_confirmation check (
    status <> 'approved' or (length(trim(coalesce(confirmation_reference, ''))) > 0 and approved_by is not null)
  )
);
create index costing_records_status_idx on public.costing_records(status);
create index costing_records_tour_idx on public.costing_records(tour_code);

create table public.costing_history (
  id bigint generated always as identity primary key,
  costing_id uuid not null references public.costing_records(id) on delete cascade,
  action text not null,
  changed_fields text[],
  old_values jsonb,
  new_values jsonb,
  remarks text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index costing_history_idx on public.costing_history(costing_id, changed_at);

-- ---------- Attachments ----------
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  requirement_id uuid references public.supply_requirements(id) on delete cascade,
  costing_id uuid references public.costing_records(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint attachment_has_parent check (num_nonnulls(task_id, requirement_id, costing_id) = 1)
);

-- ---------- Approvals ----------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('task_completion', 'deadline_extension', 'costing')),
  task_id uuid references public.tasks(id) on delete cascade,
  costing_id uuid references public.costing_records(id) on delete cascade,
  extension_id uuid references public.deadline_extensions(id) on delete cascade,
  status public.approval_status not null default 'pending',
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  remarks text
);
create index approvals_status_idx on public.approvals(status, kind);

-- ---------- Requirement history ----------
create table public.requirement_history (
  id bigint generated always as identity primary key,
  requirement_id uuid not null references public.supply_requirements(id) on delete cascade,
  previous_status public.requirement_status,
  new_status public.requirement_status not null,
  remarks text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index requirement_history_idx on public.requirement_history(requirement_id, changed_at);

-- ---------- Notifications ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  link text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications(recipient_id, created_at desc);

create table public.notification_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default false,
  email_types text[] not null default array['critical_escalation', 'overdue', 'approval_request'],
  updated_at timestamptz not null default now()
);

-- ---------- Audit + settings ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_code text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log(created_at desc);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
