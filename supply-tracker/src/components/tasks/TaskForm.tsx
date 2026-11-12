"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea, ErrorBanner, useToast } from "../ui";
import { useLookups, useProfile } from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRIORITIES, PRIORITY_LABEL, REQ_TYPES, REQ_TYPE_LABEL } from "@/lib/constants";
import { fieldErrors, taskSchema } from "@/lib/validation";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import type { TaskRow } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  task?: TaskRow | null;              // edit mode
  groupCodes?: string[];             // restrict categories (e.g. Product Management page)
  defaults?: Partial<Record<string, string>>;
}

const empty = {
  title: "", description: "", category_id: "", requirement_type: "standard", priority: "medium", owner_id: "",
  contributor_ids: [] as string[], start_date: "", due_at: "", estimated_hours: "", destination: "", vendor_id: "",
};

export default function TaskForm({ open, onClose, onSaved, task, groupCodes, defaults }: Props) {
  const lk = useLookups();
  const me = useProfile();
  const toast = useToast();
  const [v, setV] = useState(empty);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = !!task;

  useEffect(() => {
    if (!open) return;
    setErrs({}); setError(null);
    if (task) {
      setV({
        title: task.title, description: task.description ?? "", category_id: task.category_id, requirement_type: task.requirement_type,
        priority: task.priority, owner_id: task.owner_id ?? "", contributor_ids: task.contributor_ids ?? [],
        start_date: task.start_date ?? "", due_at: toLocalInput(task.due_at), estimated_hours: task.estimated_hours?.toString() ?? "",
        destination: task.destination ?? "", vendor_id: task.vendor_id ?? "",
      });
    } else {
      const due = new Date(); due.setHours(18, 0, 0, 0);
      if (due < new Date()) due.setDate(due.getDate() + 1);
      setV({ ...empty, start_date: new Date().toISOString().slice(0, 10), due_at: toLocalInput(due.toISOString()), ...(defaults ?? {}) });
    }
  }, [open, task, defaults]);

  const set = (patch: Partial<typeof empty>) => setV((s) => ({ ...s, ...patch }));
  const categories = useMemo(() => lk.groups
    .filter((g) => !groupCodes || groupCodes.includes(g.code))
    .flatMap((g) => lk.categories.filter((c) => c.group_id === g.id && (c.is_active || c.id === v.category_id))
      .map((c) => ({ value: c.id, label: `${g.code} · ${g.name} — ${c.name}` }))), [lk.groups, lk.categories, groupCodes, v.category_id]);
  const employees = lk.employees.filter((e) => e.employment_status !== "inactive" || e.id === v.owner_id);

  async function save() {
    setError(null);
    const parsed = taskSchema.safeParse({ ...v, estimated_hours: v.estimated_hours === "" ? undefined : v.estimated_hours });
    if (!parsed.success) { setErrs(fieldErrors(parsed.error)); return; }
    setErrs({});
    const d = parsed.data;
    const sb = supabaseBrowser();
    setBusy(true);
    try {
      if (editing && task) {
        const patch: Record<string, unknown> = {
          title: d.title, description: d.description, category_id: d.category_id, requirement_type: d.requirement_type,
          start_date: d.start_date, estimated_hours: d.estimated_hours ?? null, destination: d.destination, vendor_id: d.vendor_id,
        };
        if (me.isManager && d.priority !== task.priority) patch.priority = d.priority;
        if (!task.due_at) patch.due_at = fromLocalInput(d.due_at);
        const { error } = await sb.from("tasks").update(patch).eq("id", task.id);
        if (error) throw error;
        toast("success", `${task.task_code} updated`);
        onSaved(task.id);
      } else {
        const { data, error } = await sb.from("tasks").insert({
          title: d.title, description: d.description, category_id: d.category_id, requirement_type: d.requirement_type,
          priority: d.priority, owner_id: d.owner_id, status: "assigned", start_date: d.start_date,
          due_at: fromLocalInput(d.due_at), estimated_hours: d.estimated_hours ?? null, destination: d.destination,
          vendor_id: d.vendor_id, requirement_id: defaults?.requirement_id || null,
        }).select("id, task_code").single();
        if (error) throw error;
        const contributors = d.contributor_ids.filter((c) => c !== d.owner_id);
        if (contributors.length) {
          const { error: e2 } = await sb.rpc("reassign_task", { p_task_id: data.id, p_owner: d.owner_id, p_contributors: contributors, p_remarks: "Team members added at creation" });
          if (e2) throw e2;
        }
        toast("success", `${data.task_code} created and assigned`);
        onSaved(data.id);
      }
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit ${task?.task_code}` : "New task"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{editing ? "Save changes" : "Create task"}</Button></>}>
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Task title" required error={errs.title} className="sm:col-span-2">
          <Input value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} autoFocus />
        </Field>
        <Field label="Detailed description" error={errs.description} className="sm:col-span-2">
          <Textarea rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Task category" required error={errs.category_id} className="sm:col-span-2">
          <Select placeholder="Select category…" options={categories} value={v.category_id}
            onChange={(e) => {
              const c = lk.categoryById.get(e.target.value);
              set({ category_id: e.target.value, estimated_hours: v.estimated_hours || (c?.default_effort_hours?.toString() ?? "") });
            }} />
        </Field>
        <Field label="Priority" required hint={editing && !me.isManager ? "Only the manager can change priority" : "Importance"}>
          <Select disabled={editing && !me.isManager} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} value={v.priority} onChange={(e) => set({ priority: e.target.value })} />
        </Field>
        <Field label="Requirement type" required hint="Nature of the incoming work">
          <Select options={REQ_TYPES.map((p) => ({ value: p, label: REQ_TYPE_LABEL[p] }))} value={v.requirement_type} onChange={(e) => set({ requirement_type: e.target.value })} />
        </Field>
        {!editing && (
          <>
            <Field label="Accountable owner" required error={errs.owner_id}>
              <Select placeholder="Select employee…" value={v.owner_id} onChange={(e) => set({ owner_id: e.target.value })}
                options={employees.map((e) => ({ value: e.id, label: `${e.full_name} · ${e.designation}` }))} />
            </Field>
            <Field label="Additional team members" hint="Hold Ctrl/⌘ to select several">
              <select multiple value={v.contributor_ids} onChange={(e) => set({ contributor_ids: [...e.target.selectedOptions].map((o) => o.value) })}
                className="block h-[76px] w-full rounded-lg border-0 bg-white px-2 py-1 text-sm ring-1 ring-inset ring-slate-300 dark:bg-slate-900 dark:ring-slate-700">
                {employees.filter((e) => e.id !== v.owner_id).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Start date" error={errs.start_date}>
          <Input type="date" value={v.start_date} onChange={(e) => set({ start_date: e.target.value })} />
        </Field>
        <Field label="Due date & time" required error={errs.due_at}
          hint={editing && task?.due_at ? "Deadline changes go through an extension request" : undefined}>
          <Input type="datetime-local" disabled={editing && !!task?.due_at} value={v.due_at} onChange={(e) => set({ due_at: e.target.value })} />
        </Field>
        <Field label="Estimated effort (hours)" error={errs.estimated_hours}>
          <Input type="number" min={0} step={0.5} value={v.estimated_hours} onChange={(e) => set({ estimated_hours: e.target.value })} />
        </Field>
        <Field label="Destination">
          <Input value={v.destination} onChange={(e) => set({ destination: e.target.value })} />
        </Field>
        <Field label="Supplier / DMC" className="sm:col-span-2">
          <Select placeholder="—" value={v.vendor_id} onChange={(e) => set({ vendor_id: e.target.value })}
            options={lk.vendors.filter((x) => x.is_active || x.id === v.vendor_id).map((x) => ({ value: x.id, label: `${x.name} (${x.vendor_type}${x.destination ? ", " + x.destination : ""})` }))} />
        </Field>
      </div>
    </Modal>
  );
}
