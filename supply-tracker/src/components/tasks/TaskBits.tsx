"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertOctagon, Clock, Repeat } from "lucide-react";
import {
  DEADLINE_LABEL, DEADLINE_TONE, PRIORITIES, PRIORITY_LABEL, PRIORITY_TONE, REQ_TYPES, REQ_TYPE_LABEL, REQ_TYPE_TONE,
  STATUS_LABEL, STATUS_TONE, TASK_STATUSES,
} from "@/lib/constants";
import type { DeadlineState, Priority, RequirementType, TaskRow, TaskStatus } from "@/lib/types";
import { Avatar, Badge, Button, Drawer, EmptyState, Input, Select, Table, Td, Th, cx } from "../ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useLookups, type TaskFilters } from "@/lib/data";

export const StatusBadge = ({ s }: { s: TaskStatus }) => <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>;
export const PriorityBadge = ({ p }: { p: Priority }) => (
  <Badge tone={PRIORITY_TONE[p]}>{p === "critical" && <AlertOctagon className="h-3 w-3" />}{PRIORITY_LABEL[p]}</Badge>
);
export const ReqTypeBadge = ({ t }: { t: RequirementType }) => <Badge tone={REQ_TYPE_TONE[t]}>{REQ_TYPE_LABEL[t]}</Badge>;
export function DeadlineBadge({ s }: { s: DeadlineState }) {
  if (s === "on_track" || s === "closed" || s === "no_deadline") return null;
  return <Badge tone={DEADLINE_TONE[s]}><Clock className="h-3 w-3" />{DEADLINE_LABEL[s]}</Badge>;
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------
export function TaskFilterBar({ value, onChange, show = ["search", "employeeId", "categoryId", "priority", "status", "requirementType", "assignedBy"], dateRange }:
  { value: TaskFilters; onChange: (f: TaskFilters) => void; show?: (keyof TaskFilters)[];
    dateRange?: { from: string; to: string; onChange: (from: string, to: string) => void } }) {
  const lk = useLookups();
  const set = (patch: Partial<TaskFilters>) => onChange({ ...value, ...patch });
  const has = (k: keyof TaskFilters) => show.includes(k);
  const active = Object.entries(value).filter(([k, v]) => v && k !== "search").length;
  const categoryOptions = useMemo(() => lk.groups.flatMap((g) =>
    lk.categories.filter((c) => c.group_id === g.id).map((c) => ({ value: c.id, label: `${g.code} · ${c.name}` }))), [lk.groups, lk.categories]);

  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
      {has("search") && (
        <Input className="col-span-2 sm:col-span-3 lg:w-56" placeholder="Search…" value={value.search ?? ""} onChange={(e) => set({ search: e.target.value })} />
      )}
      {dateRange && (
        <>
          <Input type="date" aria-label="From date" className="lg:w-40" value={dateRange.from} onChange={(e) => dateRange.onChange(e.target.value, dateRange.to)} />
          <Input type="date" aria-label="To date" className="lg:w-40" value={dateRange.to} onChange={(e) => dateRange.onChange(dateRange.from, e.target.value)} />
        </>
      )}
      {has("employeeId") && (
        <Select className="lg:w-44" aria-label="Employee" placeholder="All employees" value={value.employeeId ?? ""} onChange={(e) => set({ employeeId: e.target.value })}
          options={lk.employees.map((e) => ({ value: e.id, label: e.full_name + (e.employment_status === "inactive" ? " (inactive)" : "") }))} />
      )}
      {has("groupCode") && (
        <Select className="lg:w-48" aria-label="Category group" placeholder="All groups" value={value.groupCode ?? ""} onChange={(e) => set({ groupCode: e.target.value })}
          options={lk.groups.map((g) => ({ value: g.code, label: `${g.code} · ${g.name}` }))} />
      )}
      {has("categoryId") && (
        <Select className="lg:w-56" aria-label="Category" placeholder="All categories" value={value.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value })} options={categoryOptions} />
      )}
      {has("priority") && (
        <Select className="lg:w-36" aria-label="Priority" placeholder="All priorities" value={value.priority ?? ""} onChange={(e) => set({ priority: e.target.value as Priority })}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
      )}
      {has("requirementType") && (
        <Select className="lg:w-36" aria-label="Requirement type" placeholder="All types" value={value.requirementType ?? ""} onChange={(e) => set({ requirementType: e.target.value as RequirementType })}
          options={REQ_TYPES.map((p) => ({ value: p, label: REQ_TYPE_LABEL[p] }))} />
      )}
      {has("status") && (
        <Select className="lg:w-48" aria-label="Status" placeholder="All statuses" value={value.status ?? ""} onChange={(e) => set({ status: e.target.value as TaskFilters["status"] })}
          options={[{ value: "open", label: "All open" }, { value: "overdue", label: "Overdue" }, ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
      )}
      {has("assignedBy") && (
        <Select className="lg:w-44" aria-label="Assigned by" placeholder="Assigned by anyone" value={value.assignedBy ?? ""} onChange={(e) => set({ assignedBy: e.target.value })}
          options={lk.profiles.map((p) => ({ value: p.id, label: p.full_name }))} />
      )}
      {active > 0 && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ search: value.search })}>Clear filters ({active})</Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task table — sortable, paginated, card layout on mobile
// ---------------------------------------------------------------------------
type SortKey = "task_code" | "title" | "owner_name" | "priority" | "status" | "due_at" | "created_at";
const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function TaskTable({ rows, pageSize = 25, compact, empty = "No tasks match these filters" }:
  { rows: TaskRow[]; pageSize?: number; compact?: boolean; empty?: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "due_at", dir: "asc" });
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      let av: string | number, bv: string | number;
      if (sort.key === "priority") { av = PRIORITY_ORDER[a.priority]; bv = PRIORITY_ORDER[b.priority]; }
      else if (sort.key === "due_at") { av = a.due_at ? Date.parse(a.due_at) : Infinity; bv = b.due_at ? Date.parse(b.due_at) : Infinity; }
      else { av = String(a[sort.key] ?? ""); bv = String(b[sort.key] ?? ""); }
      return (av < bv ? -1 : av > bv ? 1 : 0) * (sort.dir === "asc" ? 1 : -1);
    });
    return r;
  }, [rows, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  const view = sorted.slice(p * pageSize, (p + 1) * pageSize);
  const th = (key: SortKey, label: string, cls?: string) => (
    <Th className={cls} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))} sorted={sort.key === key ? sort.dir : null}>{label}</Th>
  );

  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <div>
      {/* desktop */}
      <Table className="hidden md:block">
        <thead>
          <tr>
            {th("task_code", "ID")}{th("title", "Task")}{th("owner_name", "Owner")}{th("priority", "Priority")}
            {!compact && <Th>Type</Th>}{th("status", "Status")}{th("due_at", "Due")}{!compact && <Th>Assigned by</Th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {view.map((t) => (
            <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <Td className="whitespace-nowrap font-mono text-xs"><Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/tasks/${t.id}`}>{t.task_code}</Link></Td>
              <Td className="max-w-md">
                <Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100">{t.title}</Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                  <span>{t.category_name}</span>
                  {t.requirement_code && <span>· {t.requirement_code}</span>}
                  {t.recurring_task_id && <Repeat className="h-3 w-3" aria-label="Recurring" />}
                  {t.extension_count > 0 && <Badge tone="orange">ext ×{t.extension_count}</Badge>}
                </div>
              </Td>
              <Td>
                {t.owner_name ? <span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={t.owner_name} className="h-6 w-6 text-[10px]" />{t.owner_name}
                  {t.contributor_names.length > 0 && <span className="text-xs text-slate-400">+{t.contributor_names.length}</span>}</span> : <span className="text-slate-400">Unassigned</span>}
              </Td>
              <Td><PriorityBadge p={t.priority} /></Td>
              {!compact && <Td><ReqTypeBadge t={t.requirement_type} /></Td>}
              <Td><div className="flex flex-col items-start gap-1"><StatusBadge s={t.status} /><DeadlineBadge s={t.deadline_state} /></div></Td>
              <Td className={cx("whitespace-nowrap text-xs", t.is_overdue && "font-semibold text-red-600")}>{fmtDateTime(t.due_at)}</Td>
              {!compact && <Td className="whitespace-nowrap text-xs">{t.assigned_by_name ?? "—"}</Td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {/* mobile */}
      <ul className="space-y-2 md:hidden">
        {view.map((t) => (
          <li key={t.id}>
            <Link href={`/tasks/${t.id}`} className="block rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] text-slate-500">{t.task_code}</span>
                <PriorityBadge p={t.priority} />
              </div>
              <p className="mt-1 text-sm font-medium">{t.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <StatusBadge s={t.status} /><DeadlineBadge s={t.deadline_state} />
                <span>{t.owner_name ?? "Unassigned"}</span>·<span className={cx(t.is_overdue && "text-red-600")}>Due {fmtDate(t.due_at)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{p * pageSize + 1}–{Math.min((p + 1) * pageSize, sorted.length)} of {sorted.length}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" disabled={p === 0} onClick={() => setPage(p - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Drill-down drawer used by dashboard KPIs and charts */
export function TaskListDrawer({ title, rows, onClose }: { title: string | null; rows: TaskRow[]; onClose: () => void }) {
  return (
    <Drawer open={!!title} onClose={onClose} title={<span>{title} <span className="ml-1 text-sm font-normal text-slate-500">({rows.length})</span></span>} width="max-w-4xl">
      <TaskTable rows={rows} compact pageSize={50} />
    </Drawer>
  );
}
