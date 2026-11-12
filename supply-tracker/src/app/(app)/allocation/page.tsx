"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, format, subDays } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronDown, Download, FileText, ArrowRightLeft } from "lucide-react";
import { useLookups, useProfile, useTaskRows } from "@/lib/data";
import { WORKLOAD_LABEL, WORKLOAD_TONE, endOfDay, isOpen, sameLocalDay, startOfDay, workload } from "@/lib/metrics";
import { Badge, Button, Card, ErrorBanner, Input, PageHeader, Spinner, Table, Td, Th, Avatar, cx } from "@/components/ui";
import { PriorityBadge, StatusBadge, DeadlineBadge } from "@/components/tasks/TaskBits";
import { ReassignDialog } from "@/components/tasks/TaskDialogs";
import { exportPDF, exportXLSX, type Column } from "@/lib/export";
import { fmtDateTime } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/constants";
import type { TaskRow } from "@/lib/types";

interface Row {
  id: string; name: string; designation: string; active: number; newToday: number; dueToday: number; critical: number;
  overdue: number; completedToday: number; load: ReturnType<typeof workload>; open: TaskRow[]; done: TaskRow[];
}

export default function Allocation() {
  const lk = useLookups();
  const me = useProfile();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const day = useMemo(() => new Date(`${date}T12:00:00`), [date]);
  const { rows, loading, error, reload } = useTaskRows({ from: format(subDays(day, 120), "yyyy-MM-dd"), to: date });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reassign, setReassign] = useState<TaskRow | null>(null);
  const isToday = sameLocalDay(new Date().toISOString(), day);

  const data: Row[] = useMemo(() => {
    const cutoff = isToday ? new Date() : startOfDay(day);
    return lk.employees.filter((e) => e.employment_status !== "inactive").map((e) => {
      const mine = rows.filter((t) => t.owner_id === e.id);
      const open = mine.filter((t) => isOpen(t) || t.status === "awaiting_review");
      return {
        id: e.id, name: e.full_name, designation: e.designation,
        active: open.length,
        newToday: mine.filter((t) => sameLocalDay(t.created_at, day)).length,
        dueToday: open.filter((t) => sameLocalDay(t.due_at, day)).length,
        critical: open.filter((t) => t.priority === "critical").length,
        overdue: open.filter((t) => t.status !== "awaiting_review" && t.due_at && new Date(t.due_at) < cutoff).length,
        completedToday: mine.filter((t) => t.status === "completed" && sameLocalDay(t.completed_at, day)).length,
        load: workload(e, rows, day, lk.settings),
        open: open.sort((a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9")),
        done: mine.filter((t) => t.status === "completed" && sameLocalDay(t.completed_at, day)),
      };
    }).sort((a, b) => b.load.ratio - a.load.ratio);
  }, [lk.employees, lk.settings, rows, day, isToday]);

  const leastLoaded = [...data].sort((a, b) => a.load.ratio - b.load.ratio)[0];
  const totals = data.reduce((a, r) => ({ active: a.active + r.active, due: a.due + r.dueToday, overdue: a.overdue + r.overdue, done: a.done + r.completedToday }), { active: 0, due: 0, overdue: 0, done: 0 });

  // Daily closure report: one row per task (completed today + still pending)
  type ClosureRow = { employee: string; state: string; t: TaskRow };
  const closure: ClosureRow[] = data.flatMap((r) => [
    ...r.done.map((t) => ({ employee: r.name, state: "Completed", t })),
    ...r.open.map((t) => ({ employee: r.name, state: "Pending", t })),
  ]);
  const closureCols: Column<ClosureRow>[] = [
    { header: "Employee", value: (r) => r.employee, width: 20 },
    { header: "Closure", value: (r) => r.state },
    { header: "Task ID", value: (r) => r.t.task_code },
    { header: "Task", value: (r) => r.t.title, width: 40 },
    { header: "Category", value: (r) => r.t.category_name, width: 24 },
    { header: "Priority", value: (r) => r.t.priority },
    { header: "Status", value: (r) => STATUS_LABEL[r.t.status] },
    { header: "Due", value: (r) => fmtDateTime(r.t.due_at) },
    { header: "Remarks", value: (r) => r.t.completion_remarks ?? r.t.last_delay_reason ?? "" , width: 30 },
  ];
  const meta = { title: `Daily closure report ${date}`, subtitle: `${totals.done} completed · ${totals.active} pending · ${totals.overdue} overdue`, generatedBy: me.full_name };

  return (
    <>
      <PageHeader title="Daily Task Allocation" subtitle="Who is working on what, workload balance and end-of-day closure"
        actions={<>
          <Button variant="secondary" onClick={() => exportXLSX(meta, closureCols, closure)}><Download className="h-4 w-4" /> Closure (Excel)</Button>
          <Button variant="secondary" onClick={() => exportPDF(meta, closureCols, closure, data.map((r) => [r.name, `${r.completedToday} done · ${r.active} pending · ${r.overdue} overdue`]))}><FileText className="h-4 w-4" /> Closure (PDF)</Button>
        </>} />
      <ErrorBanner message={error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" aria-label="Previous day" onClick={() => setDate(format(subDays(day, 1), "yyyy-MM-dd"))}><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" className="w-44" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button variant="secondary" aria-label="Next day" onClick={() => setDate(format(addDays(day, 1), "yyyy-MM-dd"))}><ChevronRight className="h-4 w-4" /></Button>
        {!isToday && <Button variant="ghost" onClick={() => setDate(format(new Date(), "yyyy-MM-dd"))}>Today</Button>}
        <span className="ml-auto text-sm text-slate-500">{format(day, "EEEE, d MMMM yyyy")}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Active tasks", totals.active, ""], ["Due on this day", totals.due, "text-orange-600"], ["Overdue", totals.overdue, "text-red-600"], ["Completed", totals.done, "text-emerald-600"]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500">{l}</p><p className={cx("text-xl font-semibold tabular-nums", c as string)}>{v}</p>
          </div>
        ))}
      </div>

      <Card bodyClass="p-0">
        {loading ? <Spinner /> : (
          <Table>
            <thead><tr>
              <Th>Employee</Th><Th className="text-right">Active</Th><Th className="text-right">New</Th><Th className="text-right">Due today</Th>
              <Th className="text-right">Critical</Th><Th className="text-right">Overdue</Th><Th className="text-right">Completed</Th><Th>Workload</Th><Th />
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((r) => (
                <Fragment key={r.id}>
                  <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td><Link href={`/employees/${r.id}`} className="flex items-center gap-2 font-medium hover:text-indigo-600"><Avatar name={r.name} />{r.name}</Link>
                      <span className="ml-9 text-xs text-slate-500">{r.designation}</span></Td>
                    <Td className="text-right tabular-nums">{r.active}</Td>
                    <Td className="text-right tabular-nums">{r.newToday}</Td>
                    <Td className={cx("text-right tabular-nums", r.dueToday > 0 && "font-semibold text-orange-600")}>{r.dueToday}</Td>
                    <Td className={cx("text-right tabular-nums", r.critical > 0 && "font-semibold text-red-600")}>{r.critical}</Td>
                    <Td className={cx("text-right tabular-nums", r.overdue > 0 && "font-semibold text-red-600")}>{r.overdue}</Td>
                    <Td className="text-right tabular-nums text-emerald-600">{r.completedToday}</Td>
                    <Td>
                      <div className="flex min-w-40 items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className={cx("h-full rounded-full", { low: "bg-emerald-500", moderate: "bg-blue-500", high: "bg-amber-500", overloaded: "bg-red-500" }[r.load.level])}
                            style={{ width: `${Math.min(100, r.load.ratio * 80)}%` }} />
                        </div>
                        <Badge tone={WORKLOAD_TONE[r.load.level]}>{WORKLOAD_LABEL[r.load.level]}</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">{r.load.hours}h of {r.load.capacity}h ({lk.settings.workloadHorizonDays}-day capacity)</p>
                    </Td>
                    <Td>
                      <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-expanded={expanded === r.id}>
                        Tasks <ChevronDown className={cx("h-3.5 w-3.5 transition", expanded === r.id && "rotate-180")} />
                      </Button>
                    </Td>
                  </tr>
                  {expanded === r.id && (
                    <tr><Td colSpan={9} className="bg-slate-50 dark:bg-slate-950">
                      {r.open.length === 0 && r.done.length === 0 ? <p className="py-2 text-sm text-slate-500">No active work.</p> : (
                        <ul className="space-y-1.5">
                          {[...r.done, ...r.open].map((t) => (
                            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm dark:bg-slate-900">
                              <Link href={`/tasks/${t.id}`} className="font-mono text-xs text-indigo-600">{t.task_code}</Link>
                              <span className="min-w-0 flex-1 truncate">{t.title}</span>
                              <PriorityBadge p={t.priority} /><StatusBadge s={t.status} /><DeadlineBadge s={t.deadline_state} />
                              <span className="text-xs text-slate-500">{fmtDateTime(t.due_at)}</span>
                              {t.status !== "completed" && (
                                <Button size="sm" variant="secondary" onClick={() => setReassign(t)}><ArrowRightLeft className="h-3.5 w-3.5" /> Redistribute</Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {leastLoaded && leastLoaded.id !== r.id && r.load.level !== "low" && (
                        <p className="mt-2 text-xs text-slate-500">Suggestion: <b>{leastLoaded.name}</b> has the lowest workload ({WORKLOAD_LABEL[leastLoaded.load.level]}).</p>
                      )}
                    </Td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Workload = remaining estimated hours of open tasks that are overdue or due within {lk.settings.workloadHorizonDays} days, divided by the employee&apos;s capacity for that period.
        Thresholds are configurable in Settings. {endOfDay(day) < new Date() && !isToday ? "Viewing a past date: counts reflect current task states." : ""}
      </p>
      {reassign && <ReassignDialog task={reassign} onClose={() => setReassign(null)} onDone={reload} />}
    </>
  );
}
