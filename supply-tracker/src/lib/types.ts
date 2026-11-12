export type AppRole = "admin" | "manager" | "leader";

export type TaskStatus =
  | "new" | "not_started" | "assigned" | "in_progress" | "pending_supplier"
  | "pending_clarification" | "on_hold" | "awaiting_review" | "completed" | "reopened" | "cancelled";

export type Priority = "critical" | "high" | "medium" | "low";
export type RequirementType = "urgent" | "ad_hoc" | "standard";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";
export type EmploymentStatus = "active" | "on_leave" | "inactive";
export type RequirementStatus =
  | "new" | "under_review" | "accepted" | "rejected" | "clarification_required"
  | "assigned" | "in_progress" | "completed" | "closed";
export type CostingStatus =
  | "draft" | "in_validation" | "pending_supplier" | "pending_approval" | "approved" | "rejected" | "superseded";
export type CostingBasis = "per_person" | "per_car" | "per_group";
export type CostingActivity =
  | "new_costing" | "cost_revision" | "price_discrepancy" | "pax_vs_car_validation"
  | "private_vs_sic_validation" | "seasonal_pricing" | "selling_price_validation" | "margin_impact";
export type CommentKind =
  | "remark" | "progress" | "blocker" | "completion_note" | "supplier_response" | "delay_reason" | "system";
export type DeadlineState =
  | "closed" | "submitted" | "no_deadline" | "escalated" | "overdue" | "due_shortly" | "upcoming" | "on_track";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  team_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Team { id: string; name: string; description: string | null; leader_id: string | null; is_active: boolean }
export interface CategoryGroup { id: string; code: string; name: string; sort_order: number }
export interface Category {
  id: string; group_id: string; name: string; default_effort_hours: number | null; is_active: boolean; sort_order: number;
}
export interface Department { id: string; name: string; is_active: boolean }

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  designation: string;
  team_id: string | null;
  reporting_manager_id: string | null;
  joining_date: string | null;
  employment_status: EmploymentStatus;
  daily_capacity_hours: number;
  notes: string | null;
  created_at: string;
}

export interface Vendor {
  id: string; vendor_code: string | null; name: string; vendor_type: string; destination: string | null;
  country: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  is_active: boolean; performance_rating: number | null; notes: string | null; created_at: string;
}

export interface Task {
  id: string;
  task_code: string;
  title: string;
  description: string | null;
  category_id: string;
  requirement_type: RequirementType;
  priority: Priority;
  assigned_by: string | null;
  owner_id: string | null;
  status: TaskStatus;
  start_date: string | null;
  due_at: string | null;
  original_due_at: string | null;
  extension_count: number;
  last_delay_reason: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  completion_remarks: string | null;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  quality_rating: number | null;
  reopen_count: number;
  is_escalated: boolean;
  destination: string | null;
  requirement_id: string | null;
  vendor_id: string | null;
  recurring_task_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Row of the task_overview view */
export interface TaskRow extends Task {
  owner_name: string | null;
  owner_code: string | null;
  owner_team_id: string | null;
  category_name: string;
  category_group_code: string;
  category_group_name: string;
  assigned_by_name: string | null;
  vendor_name: string | null;
  requirement_code: string | null;
  deadline_state: DeadlineState;
  is_overdue: boolean;
  is_due_today: boolean;
  completion_hours: number | null;
  completed_on_time: boolean | null;
  contributor_names: string[];
  contributor_ids: string[];
}

export interface TaskHistory {
  id: number; task_id: string; field: string; previous_status: TaskStatus | null; new_status: TaskStatus | null;
  old_value: string | null; new_value: string | null; remarks: string | null; changed_by: string | null; changed_at: string;
}
export interface TaskComment {
  id: string; task_id: string; author_id: string | null; kind: CommentKind; body: string; created_at: string;
}
export interface Attachment {
  id: string; task_id: string | null; requirement_id: string | null; costing_id: string | null; storage_path: string;
  file_name: string; size_bytes: number | null; mime_type: string | null; uploaded_by: string | null; created_at: string;
}
export interface DeadlineExtension {
  id: string; task_id: string; requested_by: string | null; requested_at: string; old_due_at: string | null;
  proposed_due_at: string; reason: string; status: ApprovalStatus; decided_by: string | null; decided_at: string | null;
  decision_remarks: string | null;
}

export interface RequirementRow {
  id: string; req_code: string; department_id: string; requested_by_name: string; description: string;
  destination: string | null; product_name: string | null; requirement_type: RequirementType; priority: Priority;
  raised_at: string; required_by: string | null; assigned_employee_id: string | null; status: RequirementStatus;
  clarification_remarks: string | null; rejection_reason: string | null; completion_remarks: string | null;
  reviewed_at: string | null; accepted_at: string | null; assigned_at: string | null; completed_at: string | null;
  closed_at: string | null; task_id: string | null; created_by: string | null; created_at: string;
  department_name: string; assignee_name: string | null; task_code: string | null; task_status: TaskStatus | null;
  pending_days: number; is_delayed: boolean;
}
export interface RequirementHistory {
  id: number; requirement_id: string; previous_status: RequirementStatus | null; new_status: RequirementStatus;
  remarks: string | null; changed_by: string | null; changed_at: string;
}

export interface CostingRow {
  id: string; costing_code: string; tour_code: string; tour_name: string; destination: string | null;
  vendor_id: string | null; supplier_name: string | null; activity_type: CostingActivity;
  existing_cost: number | null; updated_cost: number | null; currency: string; costing_basis: CostingBasis;
  transfer_type: "private" | "sic" | null; season: string | null; selling_price: number | null;
  margin: number | null; margin_pct: number | null; effective_date: string | null; status: CostingStatus;
  assigned_employee_id: string | null; task_id: string | null; supersedes_id: string | null;
  confirmation_reference: string | null; remarks: string | null; approved_by: string | null; approved_at: string | null;
  created_by: string | null; created_at: string; updated_at: string;
  vendor_name: string | null; assignee_name: string | null; approved_by_name: string | null; cost_change_pct: number | null;
}
export interface CostingHistory {
  id: number; costing_id: string; action: string; changed_fields: string[] | null;
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
  remarks: string | null; changed_by: string | null; changed_at: string;
}

export interface Notification {
  id: string; recipient_id: string; type: string; title: string; body: string | null; entity_type: string | null;
  entity_id: string | null; link: string | null; read_at: string | null; created_at: string;
}
export interface AuditEntry {
  id: number; actor_id: string | null; actor_name: string | null; action: string; entity_type: string;
  entity_id: string | null; entity_code: string | null; details: Record<string, unknown>; created_at: string;
}
export interface RecurringTask {
  id: string; title: string; description: string | null; category_id: string; owner_id: string; priority: Priority;
  requirement_type: RequirementType; estimated_hours: number | null; frequency: "daily" | "weekly" | "monthly";
  weekday: number | null; day_of_month: number | null; due_time: string; next_run_on: string; is_active: boolean;
}
export interface AppSetting { key: string; value: unknown; description: string | null }
