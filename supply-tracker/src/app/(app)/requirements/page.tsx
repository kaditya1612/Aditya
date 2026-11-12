"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Download, AlertTriangle, Timer } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAll, useLookups, useProfile } from "@/lib/data";
import type { RequirementHistory, RequirementRow, RequirementStatus } from "@/lib/types";
import {
  Badge, Button, Card, Drawer, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th, useToast, cx,
} from "@/components/ui";
import { PriorityBadge, ReqTypeBadge } from "@/components/tasks/TaskBits";
import Attachments from "@/components/Attachments";
import {
  PRIORITIES, PRIORITY_LABEL, REQ_MANAGER_ONLY, REQ_STATUSES, REQ_STATUS_LABEL, REQ_STATUS_TONE, REQ_TRANSITIONS, REQ_TYPES, REQ_TYPE_LABEL, STATUS_LABEL,
} from "@/lib/constants";
import { fieldErrors, requirementSchema } from "@/lib/validation";
import { errorMessage } from "@/lib/errors";
import { fmtDate, fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { exportCSV, exportXLSX } from "@/lib/export";
import { avg } from "@/lib/metrics";
import { requirementColumns } from "@/lib/columns";

const ReqStatus = ({ s }: { s: RequirementStatus }) => <Badge tone={REQ_STATUS_TONE[s]}>{REQ_STATUS_LABEL[s]}</Badge>;


function RequirementForm({ open, onClose, onSaved, edit }: { open: boolean; onClose: () => void; onSaved: () => void; edit?: RequirementRow | null }) {
  const lk = useLookups();
  const toast = useToast();
  const blank = { department_id: "", requested_by_name: "", description: "", destination: "", product_name: "", requirement_type: "standard", priority: "medium", raised_at: "", required_by: "" };
  const [v, setV] = useState(blank);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrs({}); setError(null);
    setV(edit ? {
      department_id: edit.department_id, requested_by_name: edit.requested_by_name, description: edit.description, destination: edit.destination ?? "",
      product_name: edit.product_name ?? "", requirement_type: edit.requirement_type, priority: edit.priority, raised_at: toLocalInput(edit.raised_at), required_by: edit.required_by ?? "",
    } : { ...blank, raised_at: toLocalInput(new Date().toISOString()) });
  }, [open, edit]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<typeof blank>) => setV((s) => ({ ...s, ...p }));

  async function save() {
    const parsed = requirementSchema.safeParse(v);
    if (!parsed.success) { setErrs(fieldErrors(parsed.error)); return; }
    setErrs({}); setBusy(true); setError(null);
    const { raised_at, ...rest } = parsed.data;
    const sb = supabaseBrowser();
    const res = edit
      ? await sb.from("supply_requirements").update(rest).eq("id", edit.id)
      : await sb.from("supply_requirements").insert({ ...rest, raised_at: raised_at ? fromLocalInput(raised_at) : undefined });
    setBusy(false);
    if (res.error) { setError(errorMessage(res.error)); return; }
    toast("success", edit ? "Requirement updated" : "Requirement recorded — managers notified");
    onSaved(); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={edit ? `Edit ${edit.req_code}` : "Record new requirement"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{edit ? "Save" : "Record requirement"}</Button></>}>
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Requesting department" required error={errs.department_id}>
          <Select placeholder="Select…" value={v.department_id} onChange={(e) => set({ department_id: e.target.value })}
            options={lk.departments.filter((d) => d.is_active || d.id === v.department_id).map((d) => ({ value: d.id, label: d.name }))} />
        </Field>
        <Field label="Requested by" required error={errs.requested_by_name} hint="Name of the person in Sales / Operations / Management">
          <Input value={v.requested_by_name} onChange={(e) => set({ requested_by_name: e.target.value })} />
        </Field>
        <Field label="Requirement description" required error={errs.description} className="sm:col-span-2">
          <Textarea rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Destination"><Input value={v.destination} onChange={(e) => set({ destination: e.target.value })} /></Field>
        <Field label="Product / Activity name"><Input value={v.product_name} onChange={(e) => set({ product_name: e.target.value })} /></Field>
        <Field label="Requirement type" required>
          <Select value={v.requirement_type} onChange={(e) => set({ requirement_type: e.target.value })} options={REQ_TYPES.map((t) => ({ value: t, label: REQ_TYPE_LABEL[t] }))} />
        </Field>
        <Field label="Priority" required>
          <Select value={v.priority} onChange={(e) => set({ priority: e.target.value })} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        </Field>
        <Field label="Date raised" hint={edit ? "Original submission date cannot be changed" : "When the request was received (cannot be in the future)"}>
          <Input type="datetime-local" disabled={!!edit} value={v.raised_at} onChange={(e) => set({ raised_at: e.target.value })} />
        </Field>
        <Field label="Required completion date"><Input type="date" value={v.required_by} onChange={(e) => set({ required_by: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AssignDialog({ req, onClose, onDone }: { req: RequirementRow; onClose: () => void; onDone: () => void }) {
  const lk = useLookups();
  const toast = useToast();
  const dept = req.department_name.toLowerCase();
  const suggested = lk.categories.find((c) => c.name.toLowerCase().startsWith(dept.split(" ")[0]!) && c.name.includes("Requirements"));
  const [emp, setEmp] = useState(req.assigned_employee_id ?? "");
  const [cat, setCat] = useState(suggested?.id ?? "");
  const [due, setDue] = useState(req.required_by ? `${req.required_by}T18:00` : "");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc("assign_requirement", {
      p_requirement_id: req.id, p_employee: emp || null, p_category: cat || null, p_due: due ? fromLocalInput(due) : null,
      p_create_task: true, p_remarks: remarks || null,
    });
    setBusy(false);
    if (error) { setError(errorMessage(error)); return; }
    toast("success", req.task_id ? "Requirement reassigned" : "Assigned — linked task created");
    onDone(); onClose();
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Assign ${req.req_code}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!emp || (!req.task_id && !cat)} onClick={submit}>Assign</Button></>}>
      <ErrorBanner message={error} />
      <div className="space-y-3">
        <Field label="Supply Team member (owner)" required>
          <Select placeholder="Select…" value={emp} onChange={(e) => setEmp(e.target.value)}
            options={lk.employees.filter((e) => e.employment_status !== "inactive").map((e) => ({ value: e.id, label: `${e.full_name} · ${e.designation}` }))} />
        </Field>
        {!req.task_id && (
          <>
            <Field label="Task category for the linked task" required>
              <Select placeholder="Select…" value={cat} onChange={(e) => setCat(e.target.value)}
                options={lk.groups.flatMap((g) => lk.categories.filter((c) => c.group_id === g.id && c.is_active).map((c) => ({ value: c.id, label: `${g.code} · ${c.name}` })))} />
            </Field>
            <Field label="Task deadline" hint="Defaults to the required completion date, 18:00"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </>
        )}
        <Field label="Remarks"><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RequirementDrawer({ req, onClose, onChanged }: { req: RequirementRow | null; onClose: () => void; onChanged: () => void }) {
  const me = useProfile();
  const lk = useLookups();
  const toast = useToast();
  const [history, setHistory] = useState<RequirementHistory[]>([]);
  const [action, setAction] = useState<RequirementStatus | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const loadHistory = useCallback(async () => {
    if (!req) return;
    const { data } = await supabaseBrowser().from("requirement_history").select("*").eq("requirement_id", req.id).order("changed_at", { ascending: false });
    setHistory((data as RequirementHistory[]) ?? []);
  }, [req]);
  useEffect(() => { void loadHistory(); setAction(null); setRemarks(""); }, [loadHistory]);
  if (!req) return null;

  const allowed = REQ_TRANSITIONS[req.status].filter((s) => (me.isManager || (!REQ_MANAGER_ONLY.includes(s) && req.status !== "rejected")));
  const needsRemarks = action === "rejected" || action === "clarification_required";

  async function transition() {
    if (!action || !req) return;
    if (action === "assigned") { setAssigning(true); setAction(null); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("transition_requirement", { p_requirement_id: req.id, p_status: action, p_remarks: remarks || null });
    setBusy(false);
    if (error) { toast("error", errorMessage(error)); return; }
    toast("success", `${req.req_code} → ${REQ_STATUS_LABEL[action]}`);
    setAction(null); setRemarks(""); onChanged(); void loadHistory();
  }

  const label: Partial<Record<RequirementStatus, string>> = {
    under_review: "Start review", accepted: "Accept", rejected: "Reject", clarification_required: "Request clarification",
    assigned: "Assign owner", in_progress: "Mark in progress", completed: "Mark completed", closed: "Close",
  };
  const editable = !["closed", "rejected"].includes(req.status);

  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2"><span className="font-mono text-sm text-slate-500">{req.req_code}</span><ReqStatus s={req.status} /></span>}>
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5"><ReqTypeBadge t={req.requirement_type} /><PriorityBadge p={req.priority} />
            {req.is_delayed && <Badge tone="red"><AlertTriangle className="h-3 w-3" />Past required date</Badge>}</div>
          <p className="whitespace-pre-wrap text-sm">{req.description}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {([
            ["Department", req.department_name], ["Requested by", req.requested_by_name], ["Destination", req.destination ?? "—"],
            ["Product / Activity", req.product_name ?? "—"], ["Date raised", fmtDateTime(req.raised_at)], ["Required by", fmtDate(req.required_by)],
            ["Assigned to", req.assignee_name ?? "—"], ["Pending for", `${req.pending_days} days`], ["Accepted", fmtDateTime(req.accepted_at)],
            ["Completed", fmtDateTime(req.completed_at)], ["Closed", fmtDateTime(req.closed_at)],
            ["Recorded by", lk.profileById.get(req.created_by ?? "")?.full_name ?? "—"],
          ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {req.task_id && (
          <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-950">
            Linked task: <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" href={`/tasks/${req.task_id}`}>{req.task_code}</Link>
            {req.task_status && <span className="text-slate-500"> · {STATUS_LABEL[req.task_status]}</span>}
          </div>
        )}
        {req.clarification_remarks && <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950"><b>Clarifications</b><p className="whitespace-pre-wrap">{req.clarification_remarks}</p></div>}
        {req.rejection_reason && <div className="rounded-lg bg-red-50 p-3 text-sm dark:bg-red-950"><b>Rejection reason:</b> {req.rejection_reason}</div>}
        {req.completion_remarks && <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950"><b>Completion remarks:</b> {req.completion_remarks}</div>}

        {(allowed.length > 0 || editable) && (
          <Card title="Workflow">
            <div className="flex flex-wrap gap-2">
              {allowed.map((s) => (
                <Button key={s} size="sm" variant={s === "rejected" ? "danger" : action === s ? "primary" : "secondary"} onClick={() => (s === "assigned" ? setAssigning(true) : setAction(s))}>{label[s] ?? REQ_STATUS_LABEL[s]}</Button>
              ))}
              {["assigned", "in_progress"].includes(req.status) && <Button size="sm" variant="secondary" onClick={() => setAssigning(true)}>Reassign</Button>}
              {editable && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit details</Button>}
            </div>
            {!me.isManager && <p className="mt-2 text-xs text-slate-500">Accepting, rejecting and closing requirements is reserved for the Supply Team Manager.</p>}
            {action && action !== "assigned" && (
              <div className="mt-3 space-y-2">
                <Field label={action === "rejected" ? "Reason for rejection" : action === "clarification_required" ? "Clarification needed" : action === "completed" ? "Completion remarks" : "Remarks"} required={needsRemarks}>
                  <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} autoFocus />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAction(null)}>Cancel</Button>
                  <Button size="sm" loading={busy} disabled={needsRemarks && !remarks.trim()} onClick={transition}>Confirm: {label[action]}</Button>
                </div>
              </div>
            )}
          </Card>
        )}
        <Card title="Supporting documents"><Attachments kind="requirement" entityId={req.id} /></Card>
        <Card title="Status history">
          <ol className="space-y-2 text-xs">
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                <span className="font-medium">{lk.profileById.get(h.changed_by ?? "")?.full_name ?? "System"}</span>{" "}
                {h.previous_status ? <>{REQ_STATUS_LABEL[h.previous_status]} → <b>{REQ_STATUS_LABEL[h.new_status]}</b></> : <>recorded as <b>{REQ_STATUS_LABEL[h.new_status]}</b></>}
                <span className="text-slate-400"> · {fmtDateTime(h.changed_at)}</span>
                {h.remarks && <p className="italic text-slate-500">“{h.remarks}”</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {assigning && <AssignDialog req={req} onClose={() => setAssigning(false)} onDone={() => { onChanged(); void loadHistory(); }} />}
      <RequirementForm open={editing} edit={req} onClose={() => setEditing(false)} onSaved={onChanged} />
    </Drawer>
  );
}

function Requirements() {
  const lk = useLookups();
  const params = useSearchParams();
  const router = useRouter();
  const [rows, setRows] = useState<RequirementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "all" | RequirementStatus>("open");
  const [f, setF] = useState({ q: "", dept: "", type: "", priority: "", assignee: "", delayed: false });
  const [creating, setCreating] = useState(false);
  const openId = params.get("open");

  const load = useCallback(async () => {
    try {
      const sb = supabaseBrowser();
      setRows(await fetchAll<RequirementRow>((a, b) => sb.from("requirement_overview").select("*").order("raised_at", { ascending: false }).range(a, b)));
      setError(null);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (tab === "open" && ["closed", "rejected"].includes(r.status)) return false;
    if (tab !== "open" && tab !== "all" && r.status !== tab) return false;
    if (f.dept && r.department_id !== f.dept) return false;
    if (f.type && r.requirement_type !== f.type) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (f.assignee && r.assigned_employee_id !== f.assignee) return false;
    if (f.delayed && !r.is_delayed) return false;
    const q = f.q.trim().toLowerCase();
    return !q || `${r.req_code} ${r.description} ${r.requested_by_name} ${r.destination ?? ""} ${r.product_name ?? ""} ${r.assignee_name ?? ""}`.toLowerCase().includes(q);
  }), [rows, tab, f]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { open: 0, all: rows.length };
    for (const r of rows) { m[r.status] = (m[r.status] ?? 0) + 1; if (!["closed", "rejected"].includes(r.status)) m.open!++; }
    return m;
  }, [rows]);

  // Delay analysis by department & type
  const delay = useMemo(() => lk.departments.map((d) => {
    const mine = rows.filter((r) => r.department_id === d.id);
    const done = mine.filter((r) => r.completed_at);
    return {
      name: d.name, total: mine.length, open: mine.filter((r) => !["closed", "rejected", "completed"].includes(r.status)).length,
      delayed: mine.filter((r) => r.is_delayed).length,
      avgDays: avg(done.map((r) => r.pending_days)),
      lateDone: done.filter((r) => r.required_by && new Date(r.completed_at!) > new Date(`${r.required_by}T23:59:59`)).length,
    };
  }).filter((d) => d.total > 0), [rows, lk.departments]);

  const selected = rows.find((r) => r.id === openId) ?? null;
  const setOpen = (id: string | null) => router.replace(id ? `/requirements?open=${id}` : "/requirements", { scroll: false });

  return (
    <>
      <PageHeader title="Supply Requirement Tracker" subtitle="Every incoming request from Sales, Operations and Management — recorded, owned and timed"
        actions={<>
          <Button variant="secondary" onClick={() => exportCSV({ title: "Supply requirements" }, requirementColumns, filtered)}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => exportXLSX({ title: "Supply requirements" }, requirementColumns, filtered)}><Download className="h-4 w-4" /> Excel</Button>
          <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New requirement</Button>
        </>} />
      <ErrorBanner message={error} />

      {delay.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {delay.map((d) => (
            <div key={d.name} className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="font-medium">{d.name}</p>
              <p className="mt-1 text-xs text-slate-500">{d.total} total · {d.open} open</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className={cx("inline-flex items-center gap-1", d.delayed > 0 ? "font-semibold text-red-600" : "text-slate-500")}><AlertTriangle className="h-3 w-3" />{d.delayed} delayed now</span>
                <span className="inline-flex items-center gap-1 text-slate-500"><Timer className="h-3 w-3" />avg {d.avgDays === null ? "—" : `${d.avgDays.toFixed(1)}d`} to complete</span>
                {d.lateDone > 0 && <span className="text-orange-600">{d.lateDone} completed late</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "open", label: `Open (${counts.open ?? 0})` }, { key: "all", label: `All (${counts.all})` },
          ...REQ_STATUSES.map((s) => ({ key: s, label: `${REQ_STATUS_LABEL[s]} (${counts[s] ?? 0})` })),
        ]} />
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap">
          <Input className="col-span-2 sm:col-span-3 lg:w-56" placeholder="Search…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <Select className="lg:w-40" placeholder="All departments" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })} options={lk.departments.map((d) => ({ value: d.id, label: d.name }))} />
          <Select className="lg:w-36" placeholder="All types" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={REQ_TYPES.map((t) => ({ value: t, label: REQ_TYPE_LABEL[t] }))} />
          <Select className="lg:w-36" placeholder="All priorities" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
          <Select className="lg:w-44" placeholder="Any assignee" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} options={lk.employees.map((e) => ({ value: e.id, label: e.full_name }))} />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={f.delayed} onChange={(e) => setF({ ...f, delayed: e.target.checked })} /> Delayed only</label>
        </div>
        {loading ? <Spinner /> : filtered.length === 0 ? <EmptyState title="No requirements here" /> : (
          <Table>
            <thead><tr>
              <Th>ID</Th><Th>Requirement</Th><Th>Department</Th><Th>Type</Th><Th>Priority</Th><Th>Raised</Th><Th>Required by</Th><Th>Owner</Th><Th>Status</Th><Th className="text-right">Pending</Th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="whitespace-nowrap font-mono text-xs text-indigo-600 dark:text-indigo-400">{r.req_code}</Td>
                  <Td className="min-w-64 max-w-md"><p className="line-clamp-2 font-medium text-slate-900 dark:text-slate-100">{r.product_name ? `${r.product_name} — ` : ""}{r.description}</p>
                    <p className="text-xs text-slate-500">{r.requested_by_name}{r.destination && ` · ${r.destination}`}</p></Td>
                  <Td>{r.department_name}</Td>
                  <Td><ReqTypeBadge t={r.requirement_type} /></Td>
                  <Td><PriorityBadge p={r.priority} /></Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(r.raised_at)}</Td>
                  <Td className={cx("whitespace-nowrap text-xs", r.is_delayed && "font-semibold text-red-600")}>{fmtDate(r.required_by)}</Td>
                  <Td className="whitespace-nowrap">{r.assignee_name ?? <span className="text-slate-400">—</span>}</Td>
                  <Td><ReqStatus s={r.status} /></Td>
                  <Td className={cx("whitespace-nowrap text-right tabular-nums", r.is_delayed && "text-red-600")}>{r.pending_days}d</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <RequirementForm open={creating} onClose={() => setCreating(false)} onSaved={load} />
      {selected && <RequirementDrawer req={selected} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><Requirements /></Suspense>;
}
