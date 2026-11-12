"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { RefreshCw, ShieldAlert, CheckCheck, CalendarClock } from "lucide-react";
import { applyTaskFilters, useLookups, useProfile, useTaskRows, type TaskFilters } from "@/lib/data";
import { KPI_DEFS, avg, bucketSeries, computeKpis, countBy, employeeProductivity, isClosed, isOpen } from "@/lib/metrics";
import { Button, Card, ErrorBanner, PageHeader, Spinner, cx } from "@/components/ui";
import { TaskFilterBar, TaskListDrawer, PriorityBadge } from "@/components/tasks/TaskBits";
import { Bars, ChartCard, Lines, SERIES } from "@/components/charts";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/constants";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, fmtHours } from "@/lib/format";
import type { DeadlineExtension, TaskRow } from "@/lib/types";

const TONE_RING: Record<string, string> = {
  slate: "text-slate-700 dark:text-slate-200", blue: "text-blue-600", indigo: "text-indigo-600", amber: "text-amber-600",
  green: "text-emerald-600", red: "text-red-600", orange: "text-orange-600", violet: "text-violet-600",
};

export default function Dashboard() {
  const me = useProfile();
  const lk = useLookups();
  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filters, setFilters] = useState<TaskFilters>({});
  const { rows, loading, error, reload } = useTaskRows({ from, to });
  const [drill, setDrill] = useState<{ title: string; rows: TaskRow[] } | null>(null);
  const [pendingExt, setPendingExt] = useState<(DeadlineExtension & { task_code?: string })[]>([]);

  useEffect(() => {
    if (!me.isManager) return;
    void supabaseBrowser().from("deadline_extensions").select("*, tasks(task_code,title)").eq("status", "pending").order("requested_at")
      .then(({ data }) => setPendingExt((data ?? []) as never));
  }, [me.isManager, rows]);

  const tasks = useMemo(() => applyTaskFilters(rows, filters), [rows, filters]);
  const kpis = useMemo(() => computeKpis(tasks), [tasks]);
  const rangeFrom = new Date(`${from}T00:00:00`);
  const rangeTo = new Date(`${to}T23:59:59`);
  const open = (title: string, r: TaskRow[]) => setDrill({ title, rows: r });

  // ----- chart data -----
  const employees = useMemo(() => lk.employees.filter((e) => e.employment_status !== "inactive"), [lk.employees]);
  const perEmployee = useMemo(() => employees.map((e) => {
    const mine = tasks.filter((t) => t.owner_id === e.id);
    const p = employeeProductivity(e.id, tasks, lk.settings);
    return {
      name: e.full_name, id: e.id,
      Completed: mine.filter((t) => t.status === "completed").length,
      "In review": mine.filter((t) => t.status === "awaiting_review").length,
      Open: mine.filter((t) => isOpen(t) && !t.is_overdue).length,
      Overdue: mine.filter((t) => t.is_overdue).length,
      rate: p.completionRate === null ? 0 : Math.round(p.completionRate * 100),
      onTime: p.onTimeRate === null ? 0 : Math.round(p.onTimeRate * 100),
    };
  }).filter((d) => d.Completed + d.Open + d.Overdue + d["In review"] > 0), [employees, tasks, lk.settings]);

  const daily = useMemo(() => bucketSeries(tasks, rangeFrom, rangeTo, "day").map((b) => ({ name: b.key.slice(5), key: b.key, Completed: b.completed, Created: b.created })), [tasks, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekly = useMemo(() => bucketSeries(tasks, rangeFrom, rangeTo, "week").map((b) => ({ name: "Wk " + b.key.slice(5), key: b.key, Created: b.created, Completed: b.completed, "On time": b.onTime })), [tasks, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthly = useMemo(() => bucketSeries(tasks, rangeFrom, rangeTo, "month").map((b) => ({ name: b.key, key: b.key, "Weighted output": b.points, Completed: b.completed })), [tasks, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingVsDone = [
    { name: "Open", value: tasks.filter((t) => isOpen(t)).length },
    { name: "Awaiting review", value: tasks.filter((t) => t.status === "awaiting_review").length },
    { name: "Completed", value: tasks.filter((t) => t.status === "completed").length },
  ];
  const byPriority = PRIORITIES.map((p) => ({
    name: PRIORITY_LABEL[p], key: p,
    Open: tasks.filter((t) => t.priority === p && !isClosed(t)).length,
    Completed: tasks.filter((t) => t.priority === p && t.status === "completed").length,
  }));
  const overdueByEmp = countBy(tasks.filter((t) => t.is_overdue), (t) => t.owner_name).map((d) => ({ name: d.name, Overdue: d.value }));
  const byGroup = countBy(tasks, (t) => t.category_group_name).map((d) => ({ name: d.name, Tasks: d.value }));
  const avgTime = lk.groups.map((g) => ({
    name: g.name,
    Hours: Math.round((avg(tasks.filter((t) => t.category_group_code === g.code && t.status === "completed").map((t) => t.completion_hours)) ?? 0) * 10) / 10,
  })).filter((d) => d.Hours > 0);

  const attention = tasks.filter((t) => t.is_escalated || (t.is_overdue && (t.priority === "critical" || t.priority === "high"))).slice(0, 8);
  const reviews = tasks.filter((t) => t.status === "awaiting_review").slice(0, 8);

  return (
    <>
      <PageHeader title={`Welcome, ${me.full_name.split(" ")[0]}`} subtitle="Supply Team overview — all figures are calculated live from the database"
        actions={<Button variant="secondary" onClick={() => reload()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <ErrorBanner message={error ?? lk.error} />
      <TaskFilterBar value={filters} onChange={setFilters} show={["employeeId", "categoryId", "priority", "status", "assignedBy", "requirementType"]}
        dateRange={{ from, to, onChange: (f, t) => { setFrom(f); setTo(t); } }} />

      {loading ? <Spinner /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {KPI_DEFS.map((k) => (
              <button key={k.key} onClick={() => open(k.label, tasks.filter(k.match))} title={k.hint}
                className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700">
                <p className="text-xs font-medium text-slate-500">{k.label}</p>
                <p className={cx("mt-1 text-2xl font-semibold tabular-nums", TONE_RING[k.tone])}>{kpis[k.key]}</p>
                <p className="mt-0.5 text-[11px] text-slate-400 group-hover:text-indigo-500">View records →</p>
              </button>
            ))}
          </div>

          {me.isManager && (attention.length > 0 || reviews.length > 0 || pendingExt.length > 0) && (
            <div className="mb-6 grid gap-4 lg:grid-cols-3">
              <Card title={<span className="flex items-center gap-1.5"><ShieldAlert className="h-4 w-4 text-red-500" />Escalations & critical overdue</span>}>
                {attention.length === 0 ? <p className="text-sm text-slate-500">Nothing escalated.</p> : (
                  <ul className="space-y-2 text-sm">{attention.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2">
                      <Link href={`/tasks/${t.id}`} className="min-w-0 hover:text-indigo-600"><span className="font-mono text-xs text-slate-500">{t.task_code}</span> {t.title}<span className="block text-xs text-slate-500">{t.owner_name} · due {fmtDateTime(t.due_at)}</span></Link>
                      <PriorityBadge p={t.priority} />
                    </li>))}</ul>
                )}
              </Card>
              <Card title={<span className="flex items-center gap-1.5"><CheckCheck className="h-4 w-4 text-violet-500" />Awaiting your approval</span>}>
                {reviews.length === 0 ? <p className="text-sm text-slate-500">No tasks awaiting review.</p> : (
                  <ul className="space-y-2 text-sm">{reviews.map((t) => (
                    <li key={t.id}><Link href={`/tasks/${t.id}`} className="hover:text-indigo-600"><span className="font-mono text-xs text-slate-500">{t.task_code}</span> {t.title}<span className="block text-xs text-slate-500">{t.owner_name} · submitted {fmtDateTime(t.submitted_at)}</span></Link></li>))}</ul>
                )}
              </Card>
              <Card title={<span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-amber-500" />Extension requests</span>}>
                {pendingExt.length === 0 ? <p className="text-sm text-slate-500">No pending requests.</p> : (
                  <ul className="space-y-2 text-sm">{pendingExt.map((x) => {
                    const tk = (x as unknown as { tasks?: { task_code: string; title: string } }).tasks;
                    return (<li key={x.id}><Link href={`/tasks/${x.task_id}`} className="hover:text-indigo-600"><span className="font-mono text-xs text-slate-500">{tk?.task_code}</span> {tk?.title}
                      <span className="block text-xs text-slate-500">→ {fmtDateTime(x.proposed_due_at)} · {x.reason}</span></Link></li>);
                  })}</ul>
                )}
              </Card>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Employee-wise task distribution" subtitle="click a bar to drill down">
              <Bars data={perEmployee} stacked horizontal series={[
                { key: "Completed", label: "Completed", color: SERIES[2] }, { key: "In review", label: "In review", color: SERIES[6] },
                { key: "Open", label: "Open", color: SERIES[0] }, { key: "Overdue", label: "Overdue", color: SERIES[7] },
              ]} onSelect={(name, key) => {
                const e = perEmployee.find((p) => p.name === name);
                const mine = tasks.filter((t) => t.owner_id === e?.id);
                const sel = key === "Completed" ? mine.filter((t) => t.status === "completed") : key === "Overdue" ? mine.filter((t) => t.is_overdue)
                  : key === "In review" ? mine.filter((t) => t.status === "awaiting_review") : mine.filter((t) => isOpen(t) && !t.is_overdue);
                open(`${name} — ${key}`, sel);
              }} />
            </ChartCard>
            <ChartCard title="Employee-wise completion rate" subtitle="% of non-cancelled tasks completed · on-time %">
              <Bars data={perEmployee} horizontal valueFormat={(v) => `${v}%`} series={[
                { key: "rate", label: "Completion rate", color: SERIES[0] }, { key: "onTime", label: "On-time rate", color: SERIES[2] },
              ]} onSelect={(name) => { const e = perEmployee.find((p) => p.name === name); open(`${name} — all tasks`, tasks.filter((t) => t.owner_id === e?.id)); }} />
            </ChartCard>
            <ChartCard title="Daily task completion" subtitle="completed vs created per day">
              <Bars data={daily} series={[{ key: "Created", label: "Created", color: SERIES[0] }, { key: "Completed", label: "Completed", color: SERIES[2] }]}
                onSelect={(name) => { const d = daily.find((x) => x.name === name); open(`Completed on ${d?.key}`, tasks.filter((t) => !!t.completed_at && t.status === "completed" && format(new Date(t.completed_at), "yyyy-MM-dd") === d?.key)); }} />
            </ChartCard>
            <ChartCard title="Weekly task completion trend">
              <Lines data={weekly} series={[
                { key: "Created", label: "Created", color: SERIES[0] }, { key: "Completed", label: "Completed", color: SERIES[2] }, { key: "On time", label: "Completed on time", color: SERIES[1] },
              ]} />
            </ChartCard>
            <ChartCard title="Monthly productivity trend" subtitle="weighted by priority, effort, timeliness & quality">
              <Bars data={monthly} series={[{ key: "Weighted output", label: "Weighted output", color: SERIES[6] }]}
                onSelect={(name) => open(`Completed in ${name}`, tasks.filter((t) => t.status === "completed" && t.completed_at && format(new Date(t.completed_at), "yyyy-MM") === name))} />
            </ChartCard>
            <ChartCard title="Pending versus completed">
              <Bars data={pendingVsDone} series={[{ key: "value", label: "Tasks", color: SERIES[0] }]}
                colorByDatum={(d) => (d.name === "Completed" ? SERIES[2] : d.name === "Open" ? SERIES[0] : SERIES[6])}
                onSelect={(name) => open(name, tasks.filter((t) => name === "Completed" ? t.status === "completed" : name === "Open" ? isOpen(t) : t.status === "awaiting_review"))} />
            </ChartCard>
            <ChartCard title="Priority-wise task distribution">
              <Bars data={byPriority} stacked series={[{ key: "Open", label: "Open", color: SERIES[0] }, { key: "Completed", label: "Completed", color: SERIES[2] }]}
                onSelect={(name, key) => { const p = byPriority.find((x) => x.name === name)!.key; open(`${name} — ${key}`, tasks.filter((t) => t.priority === p && (key === "Open" ? !isClosed(t) : t.status === "completed"))); }} />
            </ChartCard>
            <ChartCard title="Overdue task analysis" subtitle="overdue tasks by owner">
              <Bars data={overdueByEmp} horizontal series={[{ key: "Overdue", label: "Overdue", color: SERIES[7] }]}
                onSelect={(name) => open(`Overdue — ${name}`, tasks.filter((t) => t.is_overdue && (t.owner_name ?? "Unassigned") === name))} />
            </ChartCard>
            <ChartCard title="Category-wise task distribution">
              <Bars data={byGroup} horizontal series={[{ key: "Tasks", label: "Tasks", color: SERIES[0] }]}
                onSelect={(name) => open(name, tasks.filter((t) => t.category_group_name === name))} />
            </ChartCard>
            <ChartCard title="Average task completion time" subtitle="start → submission, by category group">
              <Bars data={avgTime} horizontal valueFormat={(v) => fmtHours(v)} series={[{ key: "Hours", label: "Avg time", color: SERIES[1] }]}
                onSelect={(name) => open(`Completed — ${name}`, tasks.filter((t) => t.category_group_name === name && t.status === "completed"))} />
            </ChartCard>
          </div>
        </>
      )}
      <TaskListDrawer title={drill?.title ?? null} rows={drill?.rows ?? []} onClose={() => setDrill(null)} />
    </>
  );
}
