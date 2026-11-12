import type {
  CostingActivity, CostingBasis, CostingStatus, DeadlineState, Priority, RequirementStatus,
  RequirementType, TaskStatus, CommentKind, AppRole, EmploymentStatus,
} from "./types";

export const TASK_STATUSES: TaskStatus[] = [
  "new", "not_started", "assigned", "in_progress", "pending_supplier", "pending_clarification",
  "on_hold", "awaiting_review", "completed", "reopened", "cancelled",
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: "New",
  not_started: "Not Started",
  assigned: "Assigned",
  in_progress: "In Progress",
  pending_supplier: "Pending Supplier Response",
  pending_clarification: "Pending Internal Clarification",
  on_hold: "On Hold",
  awaiting_review: "Awaiting Review",
  completed: "Completed",
  reopened: "Reopened",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<TaskStatus, Tone> = {
  new: "slate", not_started: "slate", assigned: "blue", in_progress: "indigo", pending_supplier: "amber",
  pending_clarification: "amber", on_hold: "zinc", awaiting_review: "violet", completed: "green",
  reopened: "orange", cancelled: "zinc",
};

/** Statuses that count as "open work" */
export const OPEN_STATUSES: TaskStatus[] = [
  "new", "not_started", "assigned", "in_progress", "pending_supplier", "pending_clarification", "on_hold", "reopened",
];

export const KANBAN_COLUMNS: { key: TaskStatus; label: string; includes: TaskStatus[] }[] = [
  { key: "new", label: "New", includes: ["new"] },
  { key: "not_started", label: "Not Started", includes: ["not_started"] },
  { key: "assigned", label: "Assigned", includes: ["assigned"] },
  { key: "in_progress", label: "In Progress", includes: ["in_progress", "reopened"] },
  { key: "pending_supplier", label: "Pending Supplier Response", includes: ["pending_supplier"] },
  { key: "pending_clarification", label: "Pending Clarification", includes: ["pending_clarification"] },
  { key: "on_hold", label: "On Hold", includes: ["on_hold"] },
  { key: "awaiting_review", label: "Awaiting Review", includes: ["awaiting_review"] },
  { key: "completed", label: "Completed", includes: ["completed"] },
];

export const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
export const PRIORITY_LABEL: Record<Priority, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const PRIORITY_TONE: Record<Priority, Tone> = { critical: "red", high: "orange", medium: "blue", low: "slate" };

export const REQ_TYPES: RequirementType[] = ["urgent", "ad_hoc", "standard"];
export const REQ_TYPE_LABEL: Record<RequirementType, string> = { urgent: "Urgent", ad_hoc: "Ad Hoc", standard: "Standard" };
export const REQ_TYPE_TONE: Record<RequirementType, Tone> = { urgent: "red", ad_hoc: "violet", standard: "slate" };

export const REQ_STATUSES: RequirementStatus[] = [
  "new", "under_review", "clarification_required", "accepted", "assigned", "in_progress", "completed", "closed", "rejected",
];
export const REQ_STATUS_LABEL: Record<RequirementStatus, string> = {
  new: "New", under_review: "Under Review", accepted: "Accepted", rejected: "Rejected",
  clarification_required: "Clarification Required", assigned: "Assigned", in_progress: "In Progress",
  completed: "Completed", closed: "Closed",
};
export const REQ_STATUS_TONE: Record<RequirementStatus, Tone> = {
  new: "slate", under_review: "blue", accepted: "indigo", rejected: "red", clarification_required: "amber",
  assigned: "blue", in_progress: "indigo", completed: "green", closed: "zinc",
};
/** Allowed next steps (mirrors transition_requirement in the database) */
export const REQ_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  new: ["under_review", "accepted", "rejected", "clarification_required"],
  under_review: ["accepted", "rejected", "clarification_required"],
  clarification_required: ["under_review", "accepted", "rejected"],
  accepted: ["assigned", "rejected", "clarification_required"],
  assigned: ["in_progress", "clarification_required"],
  in_progress: ["completed", "clarification_required"],
  completed: ["closed", "in_progress"],
  rejected: ["under_review"],
  closed: [],
};
export const REQ_MANAGER_ONLY: RequirementStatus[] = ["accepted", "rejected", "closed"];

export const COSTING_STATUS_LABEL: Record<CostingStatus, string> = {
  draft: "Draft", in_validation: "In Validation", pending_supplier: "Pending Supplier",
  pending_approval: "Pending Approval", approved: "Approved", rejected: "Rejected", superseded: "Superseded",
};
export const COSTING_STATUS_TONE: Record<CostingStatus, Tone> = {
  draft: "slate", in_validation: "blue", pending_supplier: "amber", pending_approval: "violet",
  approved: "green", rejected: "red", superseded: "zinc",
};
export const COSTING_ACTIVITY_LABEL: Record<CostingActivity, string> = {
  new_costing: "New costing",
  cost_revision: "Cost revision",
  price_discrepancy: "Supplier price discrepancy",
  pax_vs_car_validation: "Per-person vs per-car validation",
  private_vs_sic_validation: "Private vs SIC transfer validation",
  seasonal_pricing: "Seasonal pricing",
  selling_price_validation: "Selling price validation",
  margin_impact: "Margin impact analysis",
};
export const COSTING_BASIS_LABEL: Record<CostingBasis, string> = {
  per_person: "Per Person", per_car: "Per Car", per_group: "Per Group",
};

export const DEADLINE_LABEL: Record<DeadlineState, string> = {
  closed: "Closed", submitted: "Submitted", no_deadline: "No deadline", escalated: "Management Escalation",
  overdue: "Overdue", due_shortly: "Due Shortly", upcoming: "Upcoming", on_track: "On Track",
};
export const DEADLINE_TONE: Record<DeadlineState, Tone> = {
  closed: "zinc", submitted: "violet", no_deadline: "zinc", escalated: "red", overdue: "red",
  due_shortly: "orange", upcoming: "amber", on_track: "green",
};

export const COMMENT_KIND_LABEL: Record<CommentKind, string> = {
  remark: "Remark", progress: "Progress update", blocker: "Blocker", completion_note: "Completion note",
  supplier_response: "Supplier response", delay_reason: "Reason for delay", system: "System",
};
export const COMMENT_KIND_TONE: Record<CommentKind, Tone> = {
  remark: "slate", progress: "blue", blocker: "red", completion_note: "green", supplier_response: "amber",
  delay_reason: "orange", system: "zinc",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrator", manager: "Supply Team Manager", leader: "Supply Team Leader",
};
export const EMPLOYMENT_LABEL: Record<EmploymentStatus, string> = { active: "Active", on_leave: "On Leave", inactive: "Inactive" };

export type Tone = "slate" | "zinc" | "blue" | "indigo" | "violet" | "green" | "amber" | "orange" | "red";

// Validated categorical order (CVD-safe on adjacent pairs) — assign in order, never cycle past 8.
export const CHART_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const PRIORITY_COLOR: Record<Priority, string> = { critical: "#ef4444", high: "#f97316", medium: "#3b82f6", low: "#94a3b8" };

export const ATTACHMENT_BUCKET = "supply-attachments";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
