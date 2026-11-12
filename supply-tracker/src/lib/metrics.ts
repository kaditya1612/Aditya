import type { Employee, Priority, TaskRow } from "./types";
import { OPEN_STATUSES } from "./constants";

// ---------------------------------------------------------------------------
// Settings (loaded from app_settings; defaults mirror the seeded values)
// ---------------------------------------------------------------------------
export interface MetricSettings {
  workloadThresholds: { low: number; moderate: number; high: number };
  workloadHorizonDays: number;
  defaultTaskHours: number;
  priorityWeights: Record<Priority, number>;
  lateCompletionFactor: number;
  reopenPenalty: number;
}

export const DEFAULT_SETTINGS: MetricSettings = {
  workloadThresholds: { low: 0.5, moderate: 0.85, high: 1.1 },
  workloadHorizonDays: 3,
  defaultTaskHours: 2,
  priorityWeights: { critical: 4, high: 3, medium: 2, low: 1 },
  lateCompletionFactor: 0.7,
  reopenPenalty: 0.15,
};

export function settingsFromRows(rows: { key: string; value: unknown }[]): MetricSettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => (typeof m.get(k) === "number" ? (m.get(k) as number) : d);
  return {
    workloadThresholds: { ...DEFAULT_SETTINGS.workloadThresholds, ...((m.get("workload_thresholds") as object) ?? {}) },
    workloadHorizonDays: num("workload_horizon_days", DEFAULT_SETTINGS.workloadHorizonDays),
    defaultTaskHours: num("default_task_hours", DEFAULT_SETTINGS.defaultTaskHours),
    priorityWeights: { ...DEFAULT_SETTINGS.priorityWeights, ...((m.get("priority_weights") as object) ?? {}) },
    lateCompletionFactor: num("late_completion_factor", DEFAULT_SETTINGS.lateCompletionFactor),
    reopenPenalty: num("reopen_penalty", DEFAULT_SETTINGS.reopenPenalty),
  };
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------
export const isOpen = (t: Pick<TaskRow, "status">) => OPEN_STATUSES.includes(t.status);
export const isClosed = (t: Pick<TaskRow, "status">) => t.status === "completed" || t.status === "cancelled";
export const isActive = (t: Pick<TaskRow, "status">) => isOpen(t) || t.status === "awaiting_review";

export function sameLocalDay(iso: string | null | undefined, day: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
}
export function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// ---------------------------------------------------------------------------
// KPI cards — each carries its predicate so the UI can drill into the records
// ---------------------------------------------------------------------------
export interface KpiDef { key: string; label: string; tone: string; match: (t: TaskRow) => boolean; hint: string }

export const KPI_DEFS: KpiDef[] = [
  { key: "total", label: "Total Tasks", tone: "slate", match: () => true, hint: "All tasks in the selected range" },
  { key: "new", label: "New Tasks", tone: "slate", match: (t) => t.status === "new" || t.status === "not_started", hint: "New or not started" },
  { key: "assigned", label: "Assigned", tone: "blue", match: (t) => t.status === "assigned", hint: "Assigned, not yet started" },
  { key: "in_progress", label: "In Progress", tone: "indigo", match: (t) => t.status === "in_progress" || t.status === "reopened", hint: "Includes reopened work" },
  { key: "pending_clarification", label: "Pending Clarification", tone: "amber", match: (t) => t.status === "pending_clarification", hint: "Pending internal clarification" },
  { key: "completed", label: "Completed", tone: "green", match: (t) => t.status === "completed", hint: "Approved and closed" },
  { key: "overdue", label: "Overdue", tone: "red", match: (t) => t.is_overdue, hint: "Past deadline and not closed" },
  { key: "critical", label: "Critical Tasks", tone: "red", match: (t) => t.priority === "critical" && !isClosed(t), hint: "Open critical-priority tasks" },
  { key: "due_today", label: "Due Today", tone: "orange", match: (t) => t.is_due_today, hint: "Open tasks due today" },
  { key: "awaiting_review", label: "Awaiting Review", tone: "violet", match: (t) => t.status === "awaiting_review", hint: "Submitted for manager approval" },
];

export function computeKpis(tasks: TaskRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of KPI_DEFS) out[k.key] = tasks.filter(k.match).length;
  return out;
}

// ---------------------------------------------------------------------------
// Employee productivity — weighted by priority, effort, timeliness and quality
// ---------------------------------------------------------------------------
export interface Productivity {
  employeeId: string;
  totalAssigned: number;
  completed: number;
  inProgress: number;
  pending: number;
  overdue: number;
  dueToday: number;
  onTimeRate: number | null;     // 0..1 of completed tasks with a deadline
  avgCompletionHours: number | null;
  reopened: number;
  criticalHandled: number;
  avgQuality: number | null;     // 1..5
  completionRate: number | null; // completed / (assigned − cancelled)
  score: number;                 // weighted output points
  effortHours: number;           // estimated effort of completed work
}

export function taskWeight(t: TaskRow, s: MetricSettings = DEFAULT_SETTINGS): number {
  const effort = Math.min(3, Math.max(0.5, (t.estimated_hours ?? s.defaultTaskHours) / s.defaultTaskHours));
  const timeliness = t.completed_on_time === false ? s.lateCompletionFactor : 1;
  const quality = t.quality_rating ? 0.6 + 0.1 * t.quality_rating : 1;
  const reopen = Math.max(0.4, 1 - s.reopenPenalty * (t.reopen_count ?? 0));
  return s.priorityWeights[t.priority] * effort * timeliness * quality * reopen;
}

export function employeeProductivity(employeeId: string, tasks: TaskRow[], s: MetricSettings = DEFAULT_SETTINGS): Productivity {
  const mine = tasks.filter((t) => t.owner_id === employeeId);
  const completed = mine.filter((t) => t.status === "completed");
  const withDeadline = completed.filter((t) => t.completed_on_time !== null);
  const hours = completed.map((t) => t.completion_hours).filter((h): h is number => h !== null && h >= 0);
  const rated = completed.map((t) => t.quality_rating).filter((q): q is number => !!q);
  const notCancelled = mine.filter((t) => t.status !== "cancelled").length;
  return {
    employeeId,
    totalAssigned: mine.length,
    completed: completed.length,
    inProgress: mine.filter((t) => t.status === "in_progress" || t.status === "reopened").length,
    pending: mine.filter((t) => isOpen(t) && t.status !== "in_progress" && t.status !== "reopened").length + mine.filter((t) => t.status === "awaiting_review").length,
    overdue: mine.filter((t) => t.is_overdue).length,
    dueToday: mine.filter((t) => t.is_due_today).length,
    onTimeRate: withDeadline.length ? withDeadline.filter((t) => t.completed_on_time).length / withDeadline.length : null,
    avgCompletionHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    reopened: mine.reduce((a, t) => a + (t.reopen_count ?? 0), 0),
    criticalHandled: mine.filter((t) => t.priority === "critical").length,
    avgQuality: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
    completionRate: notCancelled ? completed.length / notCancelled : null,
    score: Math.round(completed.reduce((a, t) => a + taskWeight(t, s), 0) * 10) / 10,
    effortHours: completed.reduce((a, t) => a + (t.estimated_hours ?? s.defaultTaskHours), 0),
  };
}

// ---------------------------------------------------------------------------
// Workload indicator
// ---------------------------------------------------------------------------
export type WorkloadLevel = "low" | "moderate" | "high" | "overloaded";
export const WORKLOAD_LABEL: Record<WorkloadLevel, string> = { low: "Low Workload", moderate: "Moderate Workload", high: "High Workload", overloaded: "Overloaded" };
export const WORKLOAD_TONE: Record<WorkloadLevel, string> = { low: "green", moderate: "blue", high: "amber", overloaded: "red" };

/**
 * Load ratio = remaining estimated hours of active tasks that are overdue or due within the horizon
 * (plus undated active work), divided by the employee's capacity over the horizon.
 */
export function workload(
  employee: Pick<Employee, "id" | "daily_capacity_hours">,
  tasks: TaskRow[],
  date: Date,
  s: MetricSettings = DEFAULT_SETTINGS,
): { hours: number; capacity: number; ratio: number; level: WorkloadLevel } {
  const horizonEnd = endOfDay(new Date(date.getTime() + (s.workloadHorizonDays - 1) * 86400000));
  const hours = tasks
    .filter((t) => t.owner_id === employee.id && isOpen(t))
    .filter((t) => !t.due_at || new Date(t.due_at) <= horizonEnd)
    .reduce((a, t) => {
      const est = Number(t.estimated_hours ?? s.defaultTaskHours);
      // remaining effort = estimate minus hours already logged, never below a quarter of the estimate
      return a + Math.max(est * 0.25, est - Number(t.actual_hours ?? 0));
    }, 0);
  const capacity = Math.max(1, Number(employee.daily_capacity_hours) * s.workloadHorizonDays);
  const ratio = hours / capacity;
  const th = s.workloadThresholds;
  const level: WorkloadLevel = ratio < th.low ? "low" : ratio < th.moderate ? "moderate" : ratio < th.high ? "high" : "overloaded";
  return { hours: Math.round(hours * 10) / 10, capacity, ratio, level };
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function weekKey(d: Date): string {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return dayKey(x);
}

export function bucketSeries(
  tasks: TaskRow[], from: Date, to: Date, unit: "day" | "week" | "month",
): { key: string; created: number; completed: number; onTime: number; points: number }[] {
  const keyOf = unit === "day" ? dayKey : unit === "week" ? weekKey : monthKey;
  const buckets = new Map<string, { key: string; created: number; completed: number; onTime: number; points: number }>();
  const cursor = startOfDay(from);
  while (cursor <= to) {
    const k = keyOf(cursor);
    if (!buckets.has(k)) buckets.set(k, { key: k, created: 0, completed: 0, onTime: 0, points: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const t of tasks) {
    const c = buckets.get(keyOf(new Date(t.created_at)));
    if (c) c.created++;
    if (t.status === "completed" && t.completed_at) {
      const b = buckets.get(keyOf(new Date(t.completed_at)));
      if (b) {
        b.completed++;
        if (t.completed_on_time !== false) b.onTime++;
        b.points = Math.round((b.points + taskWeight(t)) * 10) / 10;
      }
    }
  }
  return [...buckets.values()];
}

export function countBy<T>(items: T[], key: (t: T) => string | null | undefined): { name: string; value: number }[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it) ?? "Unassigned";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function avg(nums: (number | null | undefined)[]): number | null {
  const v = nums.filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);
