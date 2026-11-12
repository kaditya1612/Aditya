import type { Column } from "@/lib/export";
import type { TaskRow } from "@/lib/types";
import { DEADLINE_LABEL, PRIORITY_LABEL, REQ_TYPE_LABEL, STATUS_LABEL } from "@/lib/constants";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const taskExportColumns: Column<TaskRow>[] = [
  { header: "Task ID", value: (t) => t.task_code, width: 13 },
  { header: "Title", value: (t) => t.title, width: 40 },
  { header: "Category group", value: (t) => t.category_group_name, width: 22 },
  { header: "Category", value: (t) => t.category_name, width: 26 },
  { header: "Owner", value: (t) => t.owner_name, width: 20 },
  { header: "Team members", value: (t) => t.contributor_names.join(", "), width: 24 },
  { header: "Assigned by", value: (t) => t.assigned_by_name, width: 18 },
  { header: "Priority", value: (t) => PRIORITY_LABEL[t.priority] },
  { header: "Requirement type", value: (t) => REQ_TYPE_LABEL[t.requirement_type] },
  { header: "Status", value: (t) => STATUS_LABEL[t.status], width: 22 },
  { header: "Deadline state", value: (t) => DEADLINE_LABEL[t.deadline_state], width: 18 },
  { header: "Created", value: (t) => fmtDate(t.created_at) },
  { header: "Start", value: (t) => fmtDate(t.start_date) },
  { header: "Original deadline", value: (t) => fmtDateTime(t.original_due_at), width: 20 },
  { header: "Current deadline", value: (t) => fmtDateTime(t.due_at), width: 20 },
  { header: "Extensions", value: (t) => t.extension_count },
  { header: "Est. hours", value: (t) => t.estimated_hours },
  { header: "Actual hours", value: (t) => t.actual_hours },
  { header: "Completed", value: (t) => fmtDateTime(t.completed_at), width: 20 },
  { header: "On time", value: (t) => (t.completed_on_time === null ? "" : t.completed_on_time ? "Yes" : "No") },
  { header: "Approval", value: (t) => t.approval_status },
  { header: "Quality (1-5)", value: (t) => t.quality_rating },
  { header: "Reopened", value: (t) => t.reopen_count },
  { header: "Destination", value: (t) => t.destination },
  { header: "Supplier / DMC", value: (t) => t.vendor_name },
  { header: "Requirement", value: (t) => t.requirement_code },
];
