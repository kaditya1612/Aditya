"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, startOfWeek, subDays } from "date-fns";
import { FileSpreadsheet, FileText, FileDown, BarChart3 } from "lucide-react";
import { fetchAll, useLookups, useProfile, useTaskRows } from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, cx } from "@/components/ui";
import { taskExportColumns } from "@/components/tasks/taskColumns";
import { costingColumns, requirementColumns } from "@/lib/columns";
import { employeeProductivity, avg, isActive, pct } from "@/lib/metrics";
import { exportCSV, exportPDF, exportXLSX, type Column } from "@/lib/export";
import { PRIORITY_LABEL } from "@/lib/constants";
import { fmtDateTime, fmtHours } from "@/lib/format";
import type { CostingRow, DeadlineExtension, RequirementRow, TaskRow } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

type ReportKey =
  | "daily" | "weekly" | "monthly" | "productivity" | "category" | "costing" | "mapping" | "supplier"
  | "urgent" | "adhoc" | "pending" | "overdue" | "completion" | "extensions";

const REPORTS: { key: ReportKey; title: string; preset: "today" | "week" | "month" }[] = [
  { key: "daily", title: "Daily Supply Team Report", preset: "today" },
  { key: "weekly", title: "Weekly Task Summary", preset: "week" },
  { key: "monthly", title: "Monthly Task Summary", preset: "month" },
  { key: "productivity", title: "Employee-wise Productivity", preset: "month" },
  { key: "category", title: "Category-wise Task Distribution", preset: "month" },
  { key: "costing", title: "Costing Activity Report", preset: "month" },
  { key: "mapping", title: "Product Mapping Report", preset: "month" },
  { key: "supplier", title: "Supplier Follow-up Report", preset: "month" },
  { key: "urgent", title: "Urgent Requirement Report", preset: "month" },
  { key: "adhoc", title: "Ad Hoc Requirement Report", preset: "month" },
  { key: "pending", title: "Pending Task Report", preset: "month" },
  { key: "overdue", title: "Overdue Task Report", preset: "month" },
  { key: "completion", title: "Task Completion Report", preset: "month" },
  { key: "extensions", title: "Deadline Extension Report", preset: "month" },
];

function presetRange(p: "today" | "week" | "month") {
  const now = new Date();
  const start = p === "today" ? now : p === "week" ? startOfWeek(now, { weekStartsOn: 1 }) : startOfMonth(now);
  return { from: format(start, "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
}

type ExtRow = DeadlineExtension & { tasks: { task_code: string; title: string; owner_id: string | null; priority: string } | null };

export default function Reports() {
  const lk = useLookups();
  const me = useProfile();
  const [key, setKey] = useState<ReportKey>("daily");
  const [range, setRange] = useState(presetRange("today"));
  const [employee, setEmployee] = useState("");
  const { rows: tasks, loading, error } = useTaskRows({ from: range.from, to: range.to });
  const [reqs, setReqs] = useState<RequirementRow[]>([]);
  const [costing, setCosting] = useState<CostingRow[]>([]);
  const [exts, setExts] = useState<ExtRow[]>([]);
  const [err2, setErr2] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const fromIso = new Date(`${range.from}T00:00:00`).toISOString();
    const toIso = new Date(`${range.to}T23:59:59.999`).toISOString();
    Promise.all([
      fetchAll<RequirementRow>((a, b) => sb.from("requirement_overview").select("*").lte("raised_at", toIso)
        .or(`raised_at.gte."${fromIso}",status.not.in.(closed,rejected)`).order("raised_at").range(a, b)),
      fetchAll<CostingRow>((a, b) => sb.from("costing_overview").select("*").gte("updated_at", fromIso).lte("created_at", toIso).order("updated_at").range(a, b)),
      fetchAll<ExtRow>((a, b) => sb.from("deadline_extensions").select("*, tasks(task_code,title,owner_id,priority)").gte("requested_at", fromIso).lte("requested_at", toIso).order("requested_at").range(a, b)),
    ]).then(([r, c, x]) => { setReqs(r); setCosting(c); setExts(x); setErr2(null); }).catch((e) => setErr2(errorMessage(e)));
  }, [range.from, range.to]);

  const report = REPORTS.find((r) => r.key === key)!;
  const inRange = (iso: string | null) => !!iso && iso.slice(0, 10) >= range.from && iso.slice(0, 10) <= range.to;
  const empTasks = useMemo(() => (employee ? tasks.filter((t) => t.owner_id === employee || t.contributor_ids.includes(employee)) : tasks), [tasks, employee]);
  const who = (pid: string | null) => lk.profileById.get(pid ?? "")?.full_name ?? "—";

  const built = useMemo((): { columns: Column<any>[]; rows: any[]; summary: [string, string | number][] } => {
    const touched = empTasks.filter((t) => inRange(t.created_at) || inRange(t.completed_at) || inRange(t.due_at) || isActive(t));
    const empList = lk.employees.filter((e) => (!employee || e.id === employee) && e.employment_status !== "inactive");
    const summaryOf = (rs: TaskRow[]): [string, string | number][] => [
      ["Tasks", rs.length], ["Completed", rs.filter((t) => t.status === "completed").length],
      ["Open", rs.filter(isActive).length], ["Overdue", rs.filter((t) => t.is_overdue).length],
      ["Critical", rs.filter((t) => t.priority === "critical").length],
    ];
    const perEmployee = (rs: TaskRow[]) => {
      const cols: Column<any>[] = [
        { header: "Employee", value: (r) => r.name, width: 22 }, { header: "Assigned", value: (r) => r.p.totalAssigned },
        { header: "Completed", value: (r) => r.p.completed }, { header: "In progress", value: (r) => r.p.inProgress },
        { header: "Pending", value: (r) => r.p.pending }, { header: "Overdue", value: (r) => r.p.overdue },
        { header: "On-time rate", value: (r) => pct(r.p.onTimeRate) }, { header: "Avg completion", value: (r) => fmtHours(r.p.avgCompletionHours) },
        { header: "Reopened", value: (r) => r.p.reopened }, { header: "Critical handled", value: (r) => r.p.criticalHandled },
        { header: "Avg quality", value: (r) => r.p.avgQuality?.toFixed(1) ?? "" }, { header: "Weighted score", value: (r) => r.p.score },
      ];
      return { columns: cols, rows: empList.map((e) => ({ name: e.full_name, p: employeeProductivity(e.id, rs, lk.settings) })), summary: summaryOf(rs) };
    };
    const reqFiltered = (type: string) => {
      const rs = reqs.filter((r) => r.requirement_type === type && (!employee || r.assigned_employee_id === employee));
      return { columns: requirementColumns, rows: rs, summary: [
        ["Requirements", rs.length], ["Open", rs.filter((r) => !["closed", "rejected", "completed"].includes(r.status)).length],
        ["Delayed", rs.filter((r) => r.is_delayed).length], ["Rejected", rs.filter((r) => r.status === "rejected").length],
        ["Avg days to complete", avg(rs.filter((r) => r.completed_at).map((r) => r.pending_days))?.toFixed(1) ?? "—"],
      ] as [string, string | number][] };
    };

    switch (key) {
      case "daily": return { columns: taskExportColumns, rows: touched, summary: [
        ...summaryOf(touched), ["Completed in period", touched.filter((t) => t.status === "completed" && inRange(t.completed_at)).length],
        ["Created in period", touched.filter((t) => inRange(t.created_at)).length]] };
      case "weekly": return perEmployee(touched);
      case "productivity": return perEmployee(touched);
      case "monthly":
      case "category": {
        const rows = lk.groups.flatMap((g) => lk.categories.filter((c) => c.group_id === g.id).map((c) => {
          const rs = touched.filter((t) => t.category_id === c.id);
          return { group: `${g.code} · ${g.name}`, name: c.name, total: rs.length, done: rs.filter((t) => t.status === "completed").length,
            open: rs.filter(isActive).length, overdue: rs.filter((t) => t.is_overdue).length,
            avgH: avg(rs.filter((t) => t.status === "completed").map((t) => t.completion_hours)) };
        })).filter((r) => r.total > 0);
        return { columns: [
          { header: "Group", value: (r) => r.group, width: 28 }, { header: "Category", value: (r) => r.name, width: 28 },
          { header: "Tasks", value: (r) => r.total }, { header: "Completed", value: (r) => r.done }, { header: "Open", value: (r) => r.open },
          { header: "Overdue", value: (r) => r.overdue }, { header: "Avg completion", value: (r) => fmtHours(r.avgH) },
          { header: "Share", value: (r) => `${Math.round((r.total / Math.max(1, touched.length)) * 100)}%` },
        ], rows, summary: summaryOf(touched) };
      }
      case "costing": {
        const rs = costing.filter((c) => !employee || c.assigned_employee_id === employee);
        return { columns: costingColumns, rows: rs, summary: [["Records", rs.length], ["Approved", rs.filter((c) => c.status === "approved").length],
          ["Pending approval", rs.filter((c) => c.status === "pending_approval").length], ["Rejected", rs.filter((c) => c.status === "rejected").length],
          ["Negative margin", rs.filter((c) => (c.margin ?? 0) < 0).length], ["Avg cost change %", avg(rs.map((c) => c.cost_change_pct))?.toFixed(1) ?? "—"]] };
      }
      case "mapping": {
        const rs = touched.filter((t) => ["Product Mapping", "Database Updates", "Product Sheet Verification"].includes(t.category_name));
        return { columns: taskExportColumns, rows: rs, summary: summaryOf(rs) };
      }
      case "supplier": {
        const rs = touched.filter((t) => t.category_name === "Supplier Follow-up" || t.status === "pending_supplier" || t.category_name === "Supplier Confirmation");
        return { columns: taskExportColumns, rows: rs, summary: [...summaryOf(rs), ["Awaiting supplier now", rs.filter((t) => t.status === "pending_supplier").length]] };
      }
      case "urgent": return reqFiltered("urgent");
      case "adhoc": return reqFiltered("ad_hoc");
      case "pending": { const rs = empTasks.filter(isActive); return { columns: taskExportColumns, rows: rs, summary: summaryOf(rs) }; }
      case "overdue": { const rs = empTasks.filter((t) => t.is_overdue); return { columns: taskExportColumns, rows: rs, summary: summaryOf(rs) }; }
      case "completion": {
        const rs = empTasks.filter((t) => t.status === "completed" && inRange(t.completed_at));
        return { columns: taskExportColumns, rows: rs, summary: [["Completed", rs.length], ["On time", rs.filter((t) => t.completed_on_time !== false).length],
          ["Late", rs.filter((t) => t.completed_on_time === false).length], ["Avg completion time", fmtHours(avg(rs.map((t) => t.completion_hours)))],
          ["Avg quality", avg(rs.map((t) => t.quality_rating))?.toFixed(1) ?? "—"]] };
      }
      case "extensions": {
        const rs = exts.filter((x) => !employee || x.tasks?.owner_id === employee);
        return { columns: [
          { header: "Task ID", value: (x: ExtRow) => x.tasks?.task_code }, { header: "Task", value: (x: ExtRow) => x.tasks?.title, width: 36 },
          { header: "Responsible employee", value: (x: ExtRow) => lk.employeeById.get(x.tasks?.owner_id ?? "")?.full_name, width: 20 },
          { header: "Priority", value: (x: ExtRow) => PRIORITY_LABEL[x.tasks?.priority as keyof typeof PRIORITY_LABEL] ?? "" },
          { header: "Original deadline", value: (x: ExtRow) => fmtDateTime(x.old_due_at), width: 18 },
          { header: "Revised deadline", value: (x: ExtRow) => fmtDateTime(x.proposed_due_at), width: 18 },
          { header: "Reason for delay", value: (x: ExtRow) => x.reason, width: 36 }, { header: "Requested by", value: (x: ExtRow) => who(x.requested_by) },
          { header: "Requested at", value: (x: ExtRow) => fmtDateTime(x.requested_at) }, { header: "Decision", value: (x: ExtRow) => x.status },
          { header: "Decided by", value: (x: ExtRow) => who(x.decided_by) }, { header: "Decision remarks", value: (x: ExtRow) => x.decision_remarks, width: 28 },
        ], rows: rs, summary: [["Requests", rs.length], ["Approved", rs.filter((x) => x.status === "approved").length],
          ["Rejected", rs.filter((x) => x.status === "rejected").length], ["Pending", rs.filter((x) => x.status === "pending").length]] };
      }
    }
  }, [key, empTasks, reqs, costing, exts, lk, employee, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = {
    title: report.title,
    subtitle: `${range.from} to ${range.to}${employee ? ` · ${lk.employeeById.get(employee)?.full_name}` : " · All employees"}`,
    generatedBy: me.full_name,
  };
  const previewCols = built.columns.slice(0, 9);

  return (
    <>
      <PageHeader title="Reports & Analytics" subtitle="Every report is generated from live database records" />
      <ErrorBanner message={error ?? err2} />
      <div className="grid gap-5 lg:grid-cols-[17rem_1fr]">
        <Card bodyClass="p-2">
          <ul className="space-y-0.5">
            {REPORTS.map((r, i) => (
              <li key={r.key}>
                <button onClick={() => { setKey(r.key); setRange(presetRange(r.preset)); }}
                  className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm", key === r.key ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "hover:bg-slate-50 dark:hover:bg-slate-800")}>
                  <span className="w-5 text-right text-xs text-slate-400">{i + 1}.</span>{r.title}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card title={<span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-500" />{report.title}</span>}
            actions={<>
              <Button size="sm" variant="secondary" disabled={!built.rows.length} onClick={() => exportCSV(meta, built.columns, built.rows)}><FileDown className="h-4 w-4" />CSV</Button>
              <Button size="sm" variant="secondary" disabled={!built.rows.length} onClick={() => exportXLSX(meta, built.columns, built.rows)}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
              <Button size="sm" disabled={!built.rows.length} onClick={() => exportPDF(meta, built.columns.slice(0, 12), built.rows, built.summary)}><FileText className="h-4 w-4" />PDF</Button>
            </>}>
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
              <Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
              <Field label="Employee">
                <Select className="w-52" placeholder="All employees" value={employee} onChange={(e) => setEmployee(e.target.value)} options={lk.employees.map((e) => ({ value: e.id, label: e.full_name }))} />
              </Field>
              <div className="flex gap-1 pb-0.5">
                {(["today", "week", "month"] as const).map((p) => <Button key={p} size="sm" variant="ghost" onClick={() => setRange(presetRange(p))}>{p === "today" ? "Today" : p === "week" ? "This week" : "This month"}</Button>)}
                <Button size="sm" variant="ghost" onClick={() => setRange({ from: format(subDays(new Date(), 89), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") })}>90 days</Button>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {built.summary.map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800"><p className="text-[11px] text-slate-500">{k}</p><p className="text-lg font-semibold tabular-nums">{v}</p></div>
              ))}
            </div>
            {loading ? <Spinner /> : built.rows.length === 0 ? <EmptyState title="No records for this period" /> : (
              <>
                <Table>
                  <thead><tr>{previewCols.map((c) => <Th key={c.header}>{c.header}</Th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {built.rows.slice(0, 200).map((r, i) => (
                      <tr key={i}>{previewCols.map((c) => <Td key={c.header} className="max-w-xs truncate text-xs">{String(c.value(r) ?? "")}</Td>)}</tr>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-2 text-xs text-slate-500">
                  Showing {Math.min(200, built.rows.length)} of {built.rows.length} rows and {previewCols.length} of {built.columns.length} columns. Exports include everything.
                  {key === "pending" || key === "overdue" ? " Pending/overdue reports show the current state of all open work." : ""}
                </p>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
