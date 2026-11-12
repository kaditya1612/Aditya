"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Plus, Clock } from "lucide-react";
import { applyTaskFilters, useProfile, useTaskRows, type TaskFilters } from "@/lib/data";
import { KANBAN_COLUMNS, STATUS_LABEL } from "@/lib/constants";
import type { TaskRow, TaskStatus } from "@/lib/types";
import { Avatar, Button, ErrorBanner, PageHeader, Spinner, useToast, cx } from "@/components/ui";
import { DeadlineBadge, PriorityBadge, TaskFilterBar } from "@/components/tasks/TaskBits";
import { ApprovalDialog, StatusDialog } from "@/components/tasks/TaskDialogs";
import TaskForm from "@/components/tasks/TaskForm";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { fmtDate } from "@/lib/format";

function Card({ t }: { t: TaskRow }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: { status: t.status } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cx("cursor-grab touch-none rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800",
        isDragging && "z-50 rotate-1 opacity-90 shadow-xl", t.is_overdue && "border-l-4 border-l-red-500")}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/tasks/${t.id}`} onPointerDown={(e) => e.stopPropagation()} className="font-mono text-[11px] text-indigo-600 hover:underline dark:text-indigo-400">{t.task_code}</Link>
        <PriorityBadge p={t.priority} />
      </div>
      <p className="mt-1 line-clamp-3 text-[13px] font-medium leading-snug">{t.title}</p>
      <p className="mt-1 truncate text-[11px] text-slate-500">{t.category_name}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <Avatar name={t.owner_name} className="h-5 w-5 text-[9px]" /><span className="truncate">{t.owner_name ?? "Unassigned"}</span>
        </span>
        <span className={cx("flex shrink-0 items-center gap-0.5 text-[11px]", t.is_overdue ? "font-semibold text-red-600" : "text-slate-500")}>
          <Clock className="h-3 w-3" />{fmtDate(t.due_at)}
        </span>
      </div>
      {(t.status === "reopened" || ["overdue", "escalated", "due_shortly"].includes(t.deadline_state)) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {t.status === "reopened" && <span className="rounded bg-orange-100 px-1 text-[10px] font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300">Reopened</span>}
          <DeadlineBadge s={t.deadline_state} />
        </div>
      )}
    </div>
  );
}

function Column({ col, items }: { col: (typeof KANBAN_COLUMNS)[number]; items: TaskRow[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div ref={setNodeRef} className={cx("flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80 transition dark:bg-slate-900", isOver && "ring-2 ring-indigo-400")}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{col.label}</h3>
        <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{items.length}</span>
      </div>
      <div className="scroll-thin flex max-h-[calc(100vh-17rem)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {items.map((t) => <Card key={t.id} t={t} />)}
      </div>
    </div>
  );
}

export default function Kanban() {
  const me = useProfile();
  const toast = useToast();
  const [from, setFrom] = useState(format(subDays(new Date(), 60), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const { rows, setRows, loading, error, reload } = useTaskRows({ from, to });
  const [filters, setFilters] = useState<TaskFilters>({});
  const [dialog, setDialog] = useState<{ kind: "status" | "approve"; task: TaskRow; status?: TaskStatus } | null>(null);
  const [creating, setCreating] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const visible = useMemo(() => applyTaskFilters(rows, filters).filter((t) => t.status !== "cancelled"), [rows, filters]);
  const byColumn = useMemo(() => {
    const m = new Map<TaskStatus, TaskRow[]>();
    for (const c of KANBAN_COLUMNS) m.set(c.key, visible.filter((t) => c.includes.includes(t.status)));
    return m;
  }, [visible]);

  async function onDragEnd(e: DragEndEvent) {
    const target = e.over?.id as TaskStatus | undefined;
    const task = rows.find((r) => r.id === e.active.id);
    if (!target || !task) return;
    const col = KANBAN_COLUMNS.find((c) => c.key === target)!;
    if (col.includes.includes(task.status)) return;

    if (target === "completed") {
      if (!me.isManager) { toast("error", "Completion needs manager approval — move the card to Awaiting Review."); return; }
      if (task.status !== "awaiting_review") { toast("info", "Move the task to Awaiting Review first; completion is approved from there."); return; }
      setDialog({ kind: "approve", task });
      return;
    }
    if (task.status === "completed" || task.status === "cancelled") { toast("error", "Closed tasks can only be reopened from the task page."); return; }
    if (target === "awaiting_review" || target === "on_hold") { setDialog({ kind: "status", task, status: target }); return; }

    const previous = task.status;
    setRows((rs) => rs.map((r) => (r.id === task.id ? { ...r, status: target } : r)));
    const { error } = await supabaseBrowser().rpc("change_task_status", { p_task_id: task.id, p_status: target, p_remarks: "Moved on Kanban board" });
    if (error) {
      setRows((rs) => rs.map((r) => (r.id === task.id ? { ...r, status: previous } : r)));
      toast("error", errorMessage(error));
    } else {
      toast("success", `${task.task_code} → ${STATUS_LABEL[target]}`);
      void reload();
    }
  }

  return (
    <>
      <PageHeader title="Kanban Board" subtitle="Drag cards between columns — every move is validated and written to the task history"
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New task</Button>} />
      <ErrorBanner message={error} />
      <TaskFilterBar value={filters} onChange={setFilters} show={["search", "employeeId", "categoryId", "priority", "requirementType"]}
        dateRange={{ from, to, onChange: (f, t) => { setFrom(f); setTo(t); } }} />
      {loading ? <Spinner /> : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="scroll-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            {KANBAN_COLUMNS.map((c) => <Column key={c.key} col={c} items={byColumn.get(c.key) ?? []} />)}
          </div>
        </DndContext>
      )}
      {dialog?.kind === "status" && <StatusDialog task={dialog.task} initial={dialog.status} onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === "approve" && <ApprovalDialog task={dialog.task} onClose={() => setDialog(null)} onDone={reload} />}
      <TaskForm open={creating} onClose={() => setCreating(false)} onSaved={() => void reload()} />
    </>
  );
}
