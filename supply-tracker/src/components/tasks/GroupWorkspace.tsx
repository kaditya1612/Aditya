"use client";
import { useMemo, useState, type ReactNode } from "react";
import { format, subDays } from "date-fns";
import { Plus } from "lucide-react";
import { applyTaskFilters, useLookups, useTaskRows, type TaskFilters } from "@/lib/data";
import { isClosed } from "@/lib/metrics";
import { Button, Card, ErrorBanner, Spinner, cx } from "../ui";
import { TaskFilterBar, TaskTable } from "./TaskBits";
import TaskForm from "./TaskForm";

/** Task workspace scoped to one or more category groups (A = Product Management, C = Vendor & DMC, …). */
export default function GroupWorkspace({ groupCodes, children }: { groupCodes: string[]; children?: ReactNode }) {
  const lk = useLookups();
  const [from, setFrom] = useState(format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const { rows, loading, error, reload } = useTaskRows({ from, to });
  const [filters, setFilters] = useState<TaskFilters>({ status: "open" });
  const [creating, setCreating] = useState(false);
  const scoped = useMemo(() => rows.filter((t) => groupCodes.includes(t.category_group_code)), [rows, groupCodes]);
  const filtered = useMemo(() => applyTaskFilters(scoped, filters), [scoped, filters]);
  const cats = useMemo(() => {
    const groupIds = lk.groups.filter((g) => groupCodes.includes(g.code)).map((g) => g.id);
    return lk.categories.filter((c) => groupIds.includes(c.group_id)).map((c) => {
      const mine = scoped.filter((t) => t.category_id === c.id);
      return { c, open: mine.filter((t) => !isClosed(t)).length, done: mine.filter((t) => t.status === "completed").length, overdue: mine.filter((t) => t.is_overdue).length };
    });
  }, [lk, scoped, groupCodes]);

  return (
    <>
      <ErrorBanner message={error} />
      {children}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {cats.map(({ c, open, done, overdue }) => (
          <button key={c.id} onClick={() => setFilters({ ...filters, categoryId: filters.categoryId === c.id ? "" : c.id })}
            className={cx("rounded-xl border bg-white p-3 text-left transition dark:bg-slate-900",
              filters.categoryId === c.id ? "border-indigo-400 ring-1 ring-indigo-400" : "border-slate-200 hover:border-slate-300 dark:border-slate-800")}>
            <p className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">{c.name}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{open}<span className="ml-1 text-xs font-normal text-slate-500">open</span></p>
            <p className="text-[11px] text-slate-500">{done} completed{overdue > 0 && <span className="text-red-600"> · {overdue} overdue</span>}</p>
          </button>
        ))}
      </div>
      <Card title="Tasks" actions={<Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New task</Button>}>
        <TaskFilterBar value={filters} onChange={setFilters} show={["search", "employeeId", "priority", "status", "requirementType"]}
          dateRange={{ from, to, onChange: (f, t) => { setFrom(f); setTo(t); } }} />
        {loading ? <Spinner /> : <TaskTable rows={filtered} />}
      </Card>
      <TaskForm open={creating} onClose={() => setCreating(false)} onSaved={() => void reload()} groupCodes={groupCodes} />
    </>
  );
}
