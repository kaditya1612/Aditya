"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { differenceInCalendarDays, format, startOfMonth, subDays } from "date-fns";
import { Plus, Download, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useLookups, useProfile, useTaskRows } from "@/lib/data";
import { WORKLOAD_LABEL, WORKLOAD_TONE, employeeProductivity, isActive, pct, workload, type Productivity } from "@/lib/metrics";
import { Avatar, Badge, Button, Card, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th, useToast, cx } from "@/components/ui";
import { EMPLOYMENT_LABEL } from "@/lib/constants";
import { employeeSchema, fieldErrors } from "@/lib/validation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { fmtDate, fmtHours } from "@/lib/format";
import { exportXLSX, type Column } from "@/lib/export";
import type { Employee } from "@/lib/types";

function EmployeeForm({ open, edit, onClose, onSaved }: { open: boolean; edit: Employee | null; onClose: () => void; onSaved: () => void }) {
  const lk = useLookups();
  const toast = useToast();
  const blank = { employee_code: "", full_name: "", email: "", phone: "", designation: "", team_id: lk.teams[0]?.id ?? "", reporting_manager_id: "", joining_date: "", employment_status: "active", daily_capacity_hours: "8", notes: "" };
  const [v, setV] = useState(blank);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrs({}); setError(null);
    setV(edit ? Object.fromEntries(Object.keys(blank).map((k) => [k, (edit as unknown as Record<string, unknown>)[k]?.toString() ?? ""])) as typeof blank : blank);
  }, [open, edit]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<typeof blank>) => setV((s) => ({ ...s, ...p }));
  async function save() {
    const parsed = employeeSchema.safeParse(v);
    if (!parsed.success) { setErrs(fieldErrors(parsed.error)); return; }
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const res = edit ? await sb.from("employees").update(parsed.data).eq("id", edit.id) : await sb.from("employees").insert(parsed.data);
    setBusy(false);
    if (res.error) { setError(errorMessage(res.error)); return; }
    toast("success", edit ? "Employee updated" : "Employee added to the Supply Team directory");
    onSaved(); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={edit ? `Edit ${edit.full_name}` : "Add Supply Team member"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee name" required error={errs.full_name}><Input value={v.full_name} onChange={(e) => set({ full_name: e.target.value })} /></Field>
        <Field label="Employee ID" required error={errs.employee_code}><Input value={v.employee_code} onChange={(e) => set({ employee_code: e.target.value })} /></Field>
        <Field label="Designation" required error={errs.designation}><Input value={v.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
        <Field label="Team"><Select placeholder="—" value={v.team_id} onChange={(e) => set({ team_id: e.target.value })} options={lk.teams.map((t) => ({ value: t.id, label: t.name }))} /></Field>
        <Field label="Reporting manager / leader">
          <Select placeholder="—" value={v.reporting_manager_id} onChange={(e) => set({ reporting_manager_id: e.target.value })} options={lk.profiles.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.full_name }))} />
        </Field>
        <Field label="Joining date"><Input type="date" value={v.joining_date} onChange={(e) => set({ joining_date: e.target.value })} /></Field>
        <Field label="Employment status">
          <Select value={v.employment_status} onChange={(e) => set({ employment_status: e.target.value })} options={Object.entries(EMPLOYMENT_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Daily capacity (hours)" error={errs.daily_capacity_hours} hint="Used by the workload indicator">
          <Input type="number" min={1} max={24} step={0.5} value={v.daily_capacity_hours} onChange={(e) => set({ daily_capacity_hours: e.target.value })} />
        </Field>
        <Field label="Email" error={errs.email}><Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Delta({ now, before, invert, fmt = (n: number) => String(n) }: { now: number | null; before: number | null; invert?: boolean; fmt?: (n: number) => string }) {
  if (now === null || before === null || now === before) return null;
  const up = now > before;
  const good = invert ? !up : up;
  return (
    <span className={cx("ml-1 inline-flex items-center text-[11px]", good ? "text-emerald-600" : "text-red-600")} title={`Previous period: ${fmt(before)}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{fmt(Math.abs(now - before))}
    </span>
  );
}

export default function Employees() {
  const lk = useLookups();
  const me = useProfile();
  const [tab, setTab] = useState<"directory" | "productivity">("directory");
  const [formOpen, setFormOpen] = useState(false);
  const [edit, setEdit] = useState<Employee | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const span = differenceInCalendarDays(new Date(to), new Date(from)) + 1;
  const prevTo = format(subDays(new Date(`${from}T12:00:00`), 1), "yyyy-MM-dd");
  const prevFrom = format(subDays(new Date(`${from}T12:00:00`), span), "yyyy-MM-dd");
  // load both periods at once; split client-side
  const { rows, loading, error } = useTaskRows({ from: prevFrom, to });
  const inRange = (iso: string | null, a: string, b: string) => !!iso && iso.slice(0, 10) >= a && iso.slice(0, 10) <= b;
  const periodRows = (a: string, b: string) => rows.filter((t) => inRange(t.created_at, a, b) || inRange(t.completed_at, a, b) || (isActive(t) && t.created_at.slice(0, 10) <= b));

  const current = useMemo(() => periodRows(from, to), [rows, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = useMemo(() => periodRows(prevFrom, prevTo), [rows, prevFrom, prevTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const employees = lk.employees.filter((e) => showInactive || e.employment_status !== "inactive");
  const allOpen = useMemo(() => rows.filter(isActive), [rows]);

  const prod = useMemo(() => new Map(employees.map((e) => [e.id, {
    now: employeeProductivity(e.id, current, lk.settings), before: employeeProductivity(e.id, previous, lk.settings),
  }])), [employees, current, previous, lk.settings]);

  const exportCols: Column<Employee>[] = [
    { header: "Employee", value: (e) => e.full_name, width: 22 }, { header: "Employee ID", value: (e) => e.employee_code },
    { header: "Designation", value: (e) => e.designation, width: 22 },
    ...(["totalAssigned", "completed", "inProgress", "pending", "overdue", "dueToday", "reopened", "criticalHandled", "score"] as (keyof Productivity)[])
      .map((k) => ({ header: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), value: (e: Employee) => prod.get(e.id)?.now[k] as number })),
    { header: "On-time rate", value: (e) => pct(prod.get(e.id)?.now.onTimeRate) },
    { header: "Completion rate", value: (e) => pct(prod.get(e.id)?.now.completionRate) },
    { header: "Avg completion (h)", value: (e) => prod.get(e.id)?.now.avgCompletionHours?.toFixed(1) ?? "" },
    { header: "Avg quality", value: (e) => prod.get(e.id)?.now.avgQuality?.toFixed(1) ?? "" },
  ];

  return (
    <>
      <PageHeader title="Employee Productivity" subtitle="Supply Team directory, workload and multi-factor productivity"
        actions={<>
          {tab === "productivity" && <Button variant="secondary" onClick={() => exportXLSX({ title: "Employee productivity", subtitle: `${from} to ${to}`, generatedBy: me.full_name }, exportCols, employees)}><Download className="h-4 w-4" /> Excel</Button>}
          {me.isManager && <Button onClick={() => { setEdit(null); setFormOpen(true); }}><Plus className="h-4 w-4" /> Add employee</Button>}
        </>} />
      <ErrorBanner message={error ?? lk.error} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "directory", label: "Directory" }, { key: "productivity", label: "Productivity" }]} />

      {tab === "directory" ? (
        <Card>
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive employees</label>
          {loading ? <Spinner /> : (
            <Table>
              <thead><tr><Th>Employee</Th><Th>ID</Th><Th>Designation</Th><Th>Reporting manager</Th><Th>Joined</Th><Th>Status</Th>
                <Th className="text-right">Assigned</Th><Th className="text-right">Completed</Th><Th className="text-right">Pending</Th><Th className="text-right">Overdue</Th><Th>Active workload</Th>{me.isManager && <Th />}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {employees.map((e) => {
                  const all = rows.filter((t) => t.owner_id === e.id);
                  const load = workload(e, allOpen, new Date(), lk.settings);
                  return (
                    <tr key={e.id} className={cx(e.employment_status === "inactive" && "opacity-60")}>
                      <Td><Link href={`/employees/${e.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100"><Avatar name={e.full_name} />{e.full_name}</Link></Td>
                      <Td className="font-mono text-xs">{e.employee_code}</Td>
                      <Td>{e.designation}</Td>
                      <Td>{lk.profileById.get(e.reporting_manager_id ?? "")?.full_name ?? "—"}</Td>
                      <Td className="whitespace-nowrap">{fmtDate(e.joining_date)}</Td>
                      <Td><Badge tone={e.employment_status === "active" ? "green" : e.employment_status === "on_leave" ? "amber" : "zinc"}>{EMPLOYMENT_LABEL[e.employment_status]}</Badge></Td>
                      <Td className="text-right tabular-nums">{all.length}</Td>
                      <Td className="text-right tabular-nums">{all.filter((t) => t.status === "completed").length}</Td>
                      <Td className="text-right tabular-nums">{all.filter(isActive).length}</Td>
                      <Td className={cx("text-right tabular-nums", all.some((t) => t.is_overdue) && "font-semibold text-red-600")}>{all.filter((t) => t.is_overdue).length}</Td>
                      <Td><Badge tone={WORKLOAD_TONE[load.level]}>{WORKLOAD_LABEL[load.level]}</Badge><span className="ml-1 text-[11px] text-slate-500">{load.hours}h</span></Td>
                      {me.isManager && <Td><Button size="sm" variant="ghost" onClick={() => { setEdit(e); setFormOpen(true); }}>Edit</Button></Td>}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">Counts cover tasks with activity in the last {span + span} days plus all open work. Employees are never deleted — set status to Inactive to deactivate.</p>
        </Card>
      ) : (
        <Card>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <div className="flex gap-1 pb-0.5">
              <Button size="sm" variant="ghost" onClick={() => { setFrom(format(new Date(), "yyyy-MM-dd")); setTo(format(new Date(), "yyyy-MM-dd")); }}>Today</Button>
              <Button size="sm" variant="ghost" onClick={() => { setFrom(format(subDays(new Date(), 6), "yyyy-MM-dd")); setTo(format(new Date(), "yyyy-MM-dd")); }}>7 days</Button>
              <Button size="sm" variant="ghost" onClick={() => { setFrom(format(startOfMonth(new Date()), "yyyy-MM-dd")); setTo(format(new Date(), "yyyy-MM-dd")); }}>This month</Button>
            </div>
            <p className="ml-auto text-xs text-slate-500">Arrows compare with the previous {span}-day period ({prevFrom} → {prevTo})</p>
          </div>
          {loading ? <Spinner /> : (
            <Table>
              <thead><tr><Th>Employee</Th><Th className="text-right">Assigned</Th><Th className="text-right">Completed</Th><Th className="text-right">In progress</Th><Th className="text-right">Pending</Th>
                <Th className="text-right">Overdue</Th><Th className="text-right">Due today</Th><Th className="text-right">On-time</Th><Th className="text-right">Avg time</Th>
                <Th className="text-right">Reopened</Th><Th className="text-right">Critical</Th><Th className="text-right">Quality</Th><Th className="text-right">Score</Th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {employees.map((e) => {
                  const p = prod.get(e.id)!;
                  return (
                    <tr key={e.id}>
                      <Td><Link href={`/employees/${e.id}`} className="font-medium hover:text-indigo-600">{e.full_name}</Link></Td>
                      <Td className="text-right tabular-nums">{p.now.totalAssigned}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{p.now.completed}<Delta now={p.now.completed} before={p.before.completed} /></Td>
                      <Td className="text-right tabular-nums">{p.now.inProgress}</Td>
                      <Td className="text-right tabular-nums">{p.now.pending}</Td>
                      <Td className={cx("text-right tabular-nums", p.now.overdue > 0 && "text-red-600")}>{p.now.overdue}</Td>
                      <Td className="text-right tabular-nums">{p.now.dueToday}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{pct(p.now.onTimeRate)}<Delta now={p.now.onTimeRate} before={p.before.onTimeRate} fmt={(n) => `${Math.round(n * 100)}pt`} /></Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{fmtHours(p.now.avgCompletionHours)}</Td>
                      <Td className={cx("text-right tabular-nums", p.now.reopened > 0 && "text-orange-600")}>{p.now.reopened}</Td>
                      <Td className="text-right tabular-nums">{p.now.criticalHandled}</Td>
                      <Td className="text-right tabular-nums">{p.now.avgQuality?.toFixed(1) ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{p.now.score}<Delta now={p.now.score} before={p.before.score} fmt={(n) => n.toFixed(1)} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <b>How the score works.</b> Productivity is not a task count. Each completed task earns points = priority weight
            (Critical {lk.settings.priorityWeights.critical} · High {lk.settings.priorityWeights.high} · Medium {lk.settings.priorityWeights.medium} · Low {lk.settings.priorityWeights.low})
            × effort (estimated hours relative to a {lk.settings.defaultTaskHours}h task, capped 0.5–3×) × timeliness ({lk.settings.lateCompletionFactor}× if completed after the deadline)
            × manager quality rating (0.7–1.1×) × reopen penalty (−{lk.settings.reopenPenalty * 100}% per reopen). Read it together with on-time rate, quality, reopens and workload.
          </div>
        </Card>
      )}
      <EmployeeForm open={formOpen} edit={edit} onClose={() => setFormOpen(false)} onSaved={() => void lk.refresh()} />
    </>
  );
}
