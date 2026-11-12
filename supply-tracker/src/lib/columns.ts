import type { Column } from "./export";
import type { CostingRow, RequirementRow } from "./types";
import { COSTING_ACTIVITY_LABEL, COSTING_BASIS_LABEL, COSTING_STATUS_LABEL, PRIORITY_LABEL, REQ_STATUS_LABEL, REQ_TYPE_LABEL } from "./constants";
import { fmtDate, fmtDateTime } from "./format";

export const requirementColumns: Column<RequirementRow>[] = [
  { header: "Requirement ID", value: (r) => r.req_code, width: 14 },
  { header: "Department", value: (r) => r.department_name },
  { header: "Requested by", value: (r) => r.requested_by_name, width: 18 },
  { header: "Description", value: (r) => r.description, width: 50 },
  { header: "Destination", value: (r) => r.destination },
  { header: "Product / Activity", value: (r) => r.product_name, width: 24 },
  { header: "Type", value: (r) => REQ_TYPE_LABEL[r.requirement_type] },
  { header: "Priority", value: (r) => PRIORITY_LABEL[r.priority] },
  { header: "Date raised", value: (r) => fmtDateTime(r.raised_at), width: 18 },
  { header: "Required by", value: (r) => fmtDate(r.required_by) },
  { header: "Assigned to", value: (r) => r.assignee_name, width: 18 },
  { header: "Status", value: (r) => REQ_STATUS_LABEL[r.status], width: 20 },
  { header: "Days pending", value: (r) => r.pending_days },
  { header: "Delayed", value: (r) => (r.is_delayed ? "Yes" : "No") },
  { header: "Linked task", value: (r) => r.task_code },
  { header: "Clarifications", value: (r) => r.clarification_remarks, width: 30 },
  { header: "Rejection reason", value: (r) => r.rejection_reason, width: 30 },
  { header: "Completion remarks", value: (r) => r.completion_remarks, width: 30 },
  { header: "Completed", value: (r) => fmtDateTime(r.completed_at) },
  { header: "Closed", value: (r) => fmtDateTime(r.closed_at) },
];

export const costingColumns: Column<CostingRow>[] = [
  { header: "Costing ID", value: (r) => r.costing_code, width: 13 },
  { header: "Tour ID", value: (r) => r.tour_code, width: 14 },
  { header: "Tour name", value: (r) => r.tour_name, width: 32 },
  { header: "Destination", value: (r) => r.destination },
  { header: "Supplier / DMC", value: (r) => r.vendor_name ?? r.supplier_name, width: 22 },
  { header: "Activity", value: (r) => COSTING_ACTIVITY_LABEL[r.activity_type], width: 28 },
  { header: "Existing DB cost", value: (r) => r.existing_cost },
  { header: "Updated supplier cost", value: (r) => r.updated_cost },
  { header: "Change %", value: (r) => r.cost_change_pct },
  { header: "Currency", value: (r) => r.currency },
  { header: "Costing basis", value: (r) => COSTING_BASIS_LABEL[r.costing_basis] },
  { header: "Transfer", value: (r) => r.transfer_type?.toUpperCase() ?? "" },
  { header: "Season", value: (r) => r.season },
  { header: "Selling price", value: (r) => r.selling_price },
  { header: "Margin", value: (r) => r.margin },
  { header: "Margin %", value: (r) => r.margin_pct },
  { header: "Effective date", value: (r) => fmtDate(r.effective_date) },
  { header: "Status", value: (r) => COSTING_STATUS_LABEL[r.status] },
  { header: "Assigned employee", value: (r) => r.assignee_name, width: 20 },
  { header: "Confirmation ref", value: (r) => r.confirmation_reference, width: 22 },
  { header: "Approved by", value: (r) => r.approved_by_name },
  { header: "Approved at", value: (r) => fmtDateTime(r.approved_at) },
  { header: "Remarks", value: (r) => r.remarks, width: 30 },
];
