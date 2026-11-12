"use client";
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfMonth, subDays, subMonths } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { applyTaskFilters, useLookups, useTaskRows, type TaskFilters } from "@/lib/data";
import { WORKLOAD_LABEL, WORKLOAD_TONE, bucketSeries, employeeProductivity, isActive, pct, workload } from "@/lib/metrics";
import { Avatar, Badge, Card, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { Bars, ChartCard, Lines, SERIES } from "@/components/charts";
import { TaskFilterBar, TaskTable } from "@/components/tasks/TaskBits";
import { EMPLOYMENT_LABEL } from "@/lib/constants";
import { fmtDate, fmtHours } from "@/lib/format";

export default function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const lk = useLookups();
  const emp = lk.employeeById.get(id);
  const from = format(startOfMonth(subMonths(new Date(), 5)), "yyyy-MM-dd");
  const { rows, loading, error } = useTaskRows({ from, to: format(new Date(), "yyyy-MM-dd") });
  const [filters, setFilters] = useState<TaskFilters>({ status: "open" });
  const mine = useMemo(() => rows.filter((t) => t.owner_id === id || t.contributor_ids.includes(id)), [rows, id]);
  const owned = useMemo(() => rows.filter((t) => t.owner_id === id), [rows, id]);

  const monthStart = startOfMonth(new Date());
  const thisMonth = employeeProductivity(id, owned.filter((t) => isActive(t) || new Date(t.created_at) >= monthStart || (t.completed_at && new Date(t.completed_at) >= monthStart)), lk.settings);
  const lastMonthStart = startOfMonth(subMonths(new Date(), 1));
  const lastMonth = employeeProductivity(id, owned.filter((t) => {
    const c = new Date(t.created_at); const d = t.completed_at ? new Date(t.completed_at) : null;
    return (c >= lastMonthStart && c < monthStart) || (d && d >= lastMonthStart && d < monthStart);
  }), lk.settings);

  const monthly = useMemo(() => bucketSeries(owned, new Date(`${from}T00:00:00`), new Date(), "month").map((b) => ({
    name: format(new Date(`${b.key}-01T12:00:00`), "MMM yy"), Completed: b.completed, "On time": b.onTime, Score: b.points, Assigned: b.created,
  })), [owned, from]);
  const daily = useMemo(() => bucketSeries(owned, subDays(new Date(), 13), new Date(), "day").map((b) => ({
    name: format(new Date(`${b.key}T12:00:00`), "dd MMM"), Completed: b.completed, Assigned: b.created,
  })), [owned]);

  if (lk.loading || loading) return <Spinner />;
  if (!emp) return <ErrorBanner message="Employee not found or outside your authorised scope." />;
  const load = workload(emp, owned, new Date(), lk.settings);

  const stats: [string, string | number, string | number][] = [
    ["Tasks assigned", thisMonth.totalAssigned, lastMonth.totalAssigned],
    ["Completed", thisMonth.completed, lastMonth.completed],
    ["In progress", thisMonth.inProgress, lastMonth.inProgress],
    ["Pending", thisMonth.pending, lastMonth.pending],
    ["Overdue", thisMonth.overdue, lastMonth.overdue],
    ["Due today", thisMonth.dueToday, "—"],
    ["On-time completion", pct(thisMonth.onTimeRate), pct(lastMonth.onTimeRate)],
    ["Avg completion time", fmtHours(thisMonth.avgCompletionHours), fmtHours(lastMonth.avgCompletionHours)],
    ["Reopened tasks", thisMonth.reopened, lastMonth.reopened],
    ["Critical tasks handled", thisMonth.criticalHandled, lastMonth.criticalHandled],
    ["Avg quality (1–5)", thisMonth.avgQuality?.toFixed(1) ?? "—", lastMonth.avgQuality?.toFixed(1) ?? "—"],
    ["Weighted score", thisMonth.score, lastMonth.score],
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/employees" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Employees</Link>
      <ErrorBanner message={error} />
      <PageHeader title={emp.full_name} subtitle={<span className="flex flex-wrap items-center gap-2">{emp.designation} · {emp.employee_code}
        <Badge tone={emp.employment_status === "active" ? "green" : "zinc"}>{EMPLOYMENT_LABEL[emp.employment_status]}</Badge>
        <Badge tone={WORKLOAD_TONE[load.level]}>{WORKLOAD_LABEL[load.level]} · {load.hours}h</Badge></span>}
        actions={<Avatar name={emp.full_name} className="h-12 w-12 text-base" />} />
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Reporting to</dt><dd>{lk.profileById.get(emp.reporting_manager_id ?? "")?.full_name ?? "—"}</dd>
            <dt className="text-slate-500">Team</dt><dd>{lk.teams.find((t) => t.id === emp.team_id)?.name ?? "—"}</dd>
            <dt className="text-slate-500">Joined</dt><dd>{fmtDate(emp.joining_date)}</dd>
            <dt className="text-slate-500">Capacity</dt><dd>{emp.daily_capacity_hours} h/day</dd>
            <dt className="text-slate-500">Email</dt><dd className="break-all">{emp.email ?? "—"}</dd>
            <dt className="text-slate-500">Phone</dt><dd>{emp.phone ?? "—"}</dd>
          </dl>
        </Card>
        <Card title="Productivity — this month vs last month" className="lg:col-span-2" bodyClass="p-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 dark:divide-slate-800">
            {stats.map(([k, a, b]) => (
              <div key={k} className="p-3">
                <p className="text-[11px] text-slate-500">{k}</p>
                <p className="text-lg font-semibold tabular-nums">{a}</p>
                <p className="text-[11px] text-slate-400">last month: {b}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Month-wise comparison" subtitle="assigned vs completed">
          <Bars data={monthly} series={[{ key: "Assigned", label: "Assigned", color: SERIES[0] }, { key: "Completed", label: "Completed", color: SERIES[2] }, { key: "On time", label: "On time", color: SERIES[1] }]} />
        </ChartCard>
        <ChartCard title="Date-wise activity" subtitle="last 14 days">
          <Lines data={daily} series={[{ key: "Assigned", label: "Assigned", color: SERIES[0] }, { key: "Completed", label: "Completed", color: SERIES[2] }]} />
        </ChartCard>
      </div>
      <Card title="Tasks">
        <TaskFilterBar value={filters} onChange={setFilters} show={["search", "categoryId", "priority", "status"]} />
        <TaskTable rows={applyTaskFilters(mine, filters)} />
      </Card>
    </div>
  );
}
