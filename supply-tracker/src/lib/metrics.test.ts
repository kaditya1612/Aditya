import { describe, expect, it } from "vitest";
import { bucketSeries, computeKpis, employeeProductivity, taskWeight, workload, weekKey } from "./metrics";
import type { TaskRow } from "./types";

let n = 0;
function task(p: Partial<TaskRow>): TaskRow {
  n++;
  return {
    id: `t${n}`, task_code: `TSK-${n}`, title: "t", description: null, category_id: "c", requirement_type: "standard",
    priority: "medium", assigned_by: null, owner_id: "e1", status: "assigned", start_date: null, due_at: null,
    original_due_at: null, extension_count: 0, last_delay_reason: null, estimated_hours: 2, actual_hours: null,
    started_at: null, submitted_at: null, completed_at: null, completion_remarks: null, approval_status: "not_required",
    approved_by: null, approved_at: null, quality_rating: null, reopen_count: 0, is_escalated: false, destination: null,
    requirement_id: null, vendor_id: null, recurring_task_id: null, created_by: null, created_at: "2026-11-10T09:00:00Z",
    updated_at: "2026-11-10T09:00:00Z", owner_name: "Asha", owner_code: "SUP-001", owner_team_id: null, category_name: "Cat",
    category_group_code: "A", category_group_name: "Product Management", assigned_by_name: null, vendor_name: null,
    requirement_code: null, deadline_state: "on_track", is_overdue: false, is_due_today: false, completion_hours: null,
    completed_on_time: null, contributor_names: [], contributor_ids: [],
    ...p,
  };
}

describe("KPIs", () => {
  it("counts each card from the task rows", () => {
    const rows = [
      task({ status: "new" }), task({ status: "assigned" }), task({ status: "in_progress" }), task({ status: "reopened" }),
      task({ status: "pending_clarification" }), task({ status: "completed" }), task({ status: "awaiting_review" }),
      task({ status: "in_progress", is_overdue: true, priority: "critical" }), task({ status: "assigned", is_due_today: true }),
      task({ status: "completed", priority: "critical" }),
    ];
    const k = computeKpis(rows);
    expect(k.total).toBe(10);
    expect(k.new).toBe(1);
    expect(k.assigned).toBe(2);
    expect(k.in_progress).toBe(3);
    expect(k.pending_clarification).toBe(1);
    expect(k.completed).toBe(2);
    expect(k.overdue).toBe(1);
    expect(k.critical).toBe(1); // closed critical tasks are not counted
    expect(k.due_today).toBe(1);
    expect(k.awaiting_review).toBe(1);
  });
});

describe("productivity", () => {
  it("weights priority, effort, timeliness, quality and reopens — not just counts", () => {
    const critical = taskWeight(task({ status: "completed", priority: "critical", completed_on_time: true }));
    const low = taskWeight(task({ status: "completed", priority: "low", completed_on_time: true }));
    expect(critical).toBe(4 * low);
    const late = taskWeight(task({ status: "completed", priority: "low", completed_on_time: false }));
    expect(late).toBeCloseTo(0.7 * low);
    const reopened = taskWeight(task({ status: "completed", priority: "low", reopen_count: 2 }));
    expect(reopened).toBeCloseTo(0.7 * low);
    const bigger = taskWeight(task({ status: "completed", priority: "low", estimated_hours: 6 }));
    expect(bigger).toBe(3 * low);
    const excellent = taskWeight(task({ status: "completed", priority: "low", quality_rating: 5 }));
    expect(excellent).toBeGreaterThan(low);
  });

  it("aggregates per employee", () => {
    const rows = [
      task({ status: "completed", completed_on_time: true, completion_hours: 4, quality_rating: 4 }),
      task({ status: "completed", completed_on_time: false, completion_hours: 8, reopen_count: 1 }),
      task({ status: "in_progress", is_overdue: true }),
      task({ status: "cancelled" }),
      task({ owner_id: "e2", status: "completed" }),
    ];
    const p = employeeProductivity("e1", rows);
    expect(p.totalAssigned).toBe(4);
    expect(p.completed).toBe(2);
    expect(p.onTimeRate).toBe(0.5);
    expect(p.avgCompletionHours).toBe(6);
    expect(p.reopened).toBe(1);
    expect(p.overdue).toBe(1);
    expect(p.completionRate).toBeCloseTo(2 / 3);
    expect(p.avgQuality).toBe(4);
  });
});

describe("workload", () => {
  const day = new Date("2026-11-12T10:00:00");
  const emp = { id: "e1", daily_capacity_hours: 8 };
  it("classifies load against capacity over the horizon", () => {
    expect(workload(emp, [task({ estimated_hours: 4, due_at: "2026-11-12T12:00:00" })], day).level).toBe("low");
    const heavy = Array.from({ length: 7 }, () => task({ estimated_hours: 4, due_at: "2026-11-13T12:00:00" }));
    expect(workload(emp, heavy, day).level).toBe("overloaded"); // 28h vs 24h capacity
    const later = task({ estimated_hours: 40, due_at: "2026-12-30T12:00:00" });
    expect(workload(emp, [later], day).hours).toBe(0); // outside horizon
    const closed = task({ estimated_hours: 40, status: "completed" });
    expect(workload(emp, [closed], day).hours).toBe(0);
  });
});

describe("time series", () => {
  it("weeks start on Monday", () => {
    expect(weekKey(new Date("2026-11-15T12:00:00"))).toBe("2026-11-09"); // Sunday → previous Monday
    expect(weekKey(new Date("2026-11-16T12:00:00"))).toBe("2026-11-16");
  });
  it("buckets completions by day", () => {
    const s = bucketSeries([task({ status: "completed", completed_at: "2026-11-11T10:00:00", completed_on_time: true })],
      new Date("2026-11-10T00:00:00"), new Date("2026-11-12T23:00:00"), "day");
    expect(s.map((b) => b.completed)).toEqual([0, 1, 0]);
  });
});
