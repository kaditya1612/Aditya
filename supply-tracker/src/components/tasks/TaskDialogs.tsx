"use client";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Button, Field, Input, Modal, Select, Textarea, ErrorBanner, useToast, cx } from "../ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLookups, useProfile } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/constants";
import { errorMessage } from "@/lib/errors";
import { fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import type { Task, TaskStatus } from "@/lib/types";

type T = Pick<Task, "id" | "task_code" | "title" | "status" | "owner_id" | "due_at" | "actual_hours"> & { contributor_ids?: string[] };

/** Status options a user can pick from the current status (server re-validates). */
export function nextStatuses(current: TaskStatus, isManager: boolean): TaskStatus[] {
  if (current === "completed" || current === "cancelled") return isManager ? ["reopened"] : [];
  const open: TaskStatus[] = ["not_started", "assigned", "in_progress", "pending_supplier", "pending_clarification", "on_hold", "awaiting_review"];
  const list = open.filter((s) => s !== current);
  if (isManager) list.push("cancelled");
  return list;
}

export function StatusDialog({ task, initial, onClose, onDone }: { task: T | null; initial?: TaskStatus; onClose: () => void; onDone: () => void }) {
  const me = useProfile();
  const toast = useToast();
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [remarks, setRemarks] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (task) { setStatus(initial ?? ""); setRemarks(""); setHours(task.actual_hours?.toString() ?? ""); setError(null); } }, [task, initial]);
  if (!task) return null;
  const options = nextStatuses(task.status, me.isManager);
  const needsRemarks = status === "cancelled" || status === "reopened" || status === "on_hold";

  async function submit() {
    if (!status || !task) return;
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc("change_task_status", {
      p_task_id: task.id, p_status: status, p_remarks: remarks || null,
      p_actual_hours: status === "awaiting_review" && hours ? Number(hours) : null,
    });
    setBusy(false);
    if (error) { setError(errorMessage(error)); return; }
    toast("success", `${task.task_code} → ${STATUS_LABEL[status]}`);
    onDone(); onClose();
  }

  return (
    <Modal open onClose={onClose} size="sm" title={`Update status · ${task.task_code}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!status || (needsRemarks && !remarks.trim())} onClick={submit}>Update</Button></>}>
      <ErrorBanner message={error} />
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Current: <b>{STATUS_LABEL[task.status]}</b></p>
      <div className="space-y-3">
        <Field label="New status" required>
          <Select placeholder="Choose…" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} options={options.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        </Field>
        {status === "awaiting_review" && (
          <Field label="Actual time spent (hours)"><Input type="number" min={0} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        )}
        <Field label={status === "awaiting_review" ? "Completion remarks" : "Remarks"} required={needsRemarks}
          hint={status === "awaiting_review" ? "The manager reviews and approves before the task is closed" : "Recorded in the task history"}>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function ApprovalDialog({ task, onClose, onDone }: { task: T | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [remarks, setRemarks] = useState("");
  const [quality, setQuality] = useState(0);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (task) { setRemarks(""); setQuality(0); setError(null); } }, [task]);
  if (!task) return null;

  async function decide(approve: boolean) {
    if (!task) return;
    if (!approve && !remarks.trim()) { setError("Give a reason so the owner knows what to fix."); return; }
    setBusy(approve ? "approve" : "reject"); setError(null);
    const { error } = await supabaseBrowser().rpc("decide_task_approval", {
      p_task_id: task.id, p_approve: approve, p_remarks: remarks || null, p_quality: quality || null,
    });
    setBusy(null);
    if (error) { setError(errorMessage(error)); return; }
    toast("success", approve ? `${task.task_code} approved and closed` : `${task.task_code} sent back (reopened)`);
    onDone(); onClose();
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Review completion · ${task.task_code}`}
      footer={<>
        <Button variant="danger" loading={busy === "reject"} onClick={() => decide(false)}>Reject &amp; reopen</Button>
        <Button variant="success" loading={busy === "approve"} onClick={() => decide(true)}>Approve &amp; close</Button>
      </>}>
      <ErrorBanner message={error} />
      <p className="mb-3 text-sm font-medium">{task.title}</p>
      <Field label="Quality of work" hint="Feeds the productivity score (optional)">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setQuality(n === quality ? 0 : n)} aria-label={`${n} stars`}>
              <Star className={cx("h-6 w-6", n <= quality ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Review remarks" hint="Required when rejecting" className="mt-3">
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function ExtensionDialog({ task, onClose, onDone }: { task: T | null; onClose: () => void; onDone: () => void }) {
  const me = useProfile();
  const toast = useToast();
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (task) { setDue(toLocalInput(task.due_at)); setReason(""); setError(null); } }, [task]);
  if (!task) return null;
  async function submit() {
    if (!task) return;
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc("request_deadline_extension", { p_task_id: task.id, p_new_due: fromLocalInput(due), p_reason: reason });
    setBusy(false);
    if (error) { setError(errorMessage(error)); return; }
    toast("success", me.isManager ? "Deadline revised" : "Extension requested — awaiting manager approval");
    onDone(); onClose();
  }
  return (
    <Modal open onClose={onClose} size="sm" title={me.isManager ? `Revise deadline · ${task.task_code}` : `Request extension · ${task.task_code}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!due || !reason.trim()} onClick={submit}>{me.isManager ? "Revise deadline" : "Submit request"}</Button></>}>
      <ErrorBanner message={error} />
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Current deadline: <b>{fmtDateTime(task.due_at)}</b></p>
      <div className="space-y-3">
        <Field label="Proposed deadline" required><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Reason for delay" required hint="Kept permanently in the task history and deadline extension report">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function ReassignDialog({ task, onClose, onDone }: { task: T | null; onClose: () => void; onDone: () => void }) {
  const lk = useLookups();
  const toast = useToast();
  const [owner, setOwner] = useState("");
  const [contribs, setContribs] = useState<string[]>([]);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (task) { setOwner(task.owner_id ?? ""); setContribs(task.contributor_ids ?? []); setRemarks(""); setError(null); } }, [task]);
  if (!task) return null;
  const employees = lk.employees.filter((e) => e.employment_status !== "inactive");
  async function submit() {
    if (!task) return;
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc("reassign_task", {
      p_task_id: task.id, p_owner: owner, p_contributors: contribs.filter((c) => c !== owner), p_remarks: remarks || null,
    });
    setBusy(false);
    if (error) { setError(errorMessage(error)); return; }
    toast("success", `${task.task_code} assignment updated`);
    onDone(); onClose();
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Assign / reassign · ${task.task_code}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!owner} onClick={submit}>Save assignment</Button></>}>
      <ErrorBanner message={error} />
      <div className="space-y-3">
        <Field label="Accountable owner" required>
          <Select placeholder="Select…" value={owner} onChange={(e) => setOwner(e.target.value)} options={employees.map((e) => ({ value: e.id, label: `${e.full_name} · ${e.designation}` }))} />
        </Field>
        <Field label="Additional team members" hint="Hold Ctrl/⌘ to select several">
          <select multiple value={contribs} onChange={(e) => setContribs([...e.target.selectedOptions].map((o) => o.value))}
            className="block h-28 w-full rounded-lg border-0 bg-white px-2 py-1 text-sm ring-1 ring-inset ring-slate-300 dark:bg-slate-900 dark:ring-slate-700">
            {employees.filter((e) => e.id !== owner).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </Field>
        <Field label="Reason / remarks"><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
