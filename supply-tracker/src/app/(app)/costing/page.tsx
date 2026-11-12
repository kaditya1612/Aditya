"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Download, Info, GitBranch, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAll, useLookups, useProfile } from "@/lib/data";
import type { CostingActivity, CostingHistory, CostingRow, CostingStatus } from "@/lib/types";
import {
  Badge, Button, Card, Drawer, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, PromptDialog, Select, Spinner, Table, Td, Textarea, Th, useToast, cx,
} from "@/components/ui";
import Attachments from "@/components/Attachments";
import { COSTING_ACTIVITY_LABEL, COSTING_BASIS_LABEL, COSTING_STATUS_LABEL, COSTING_STATUS_TONE } from "@/lib/constants";
import { costingSchema, fieldErrors } from "@/lib/validation";
import { errorMessage } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { exportCSV, exportXLSX } from "@/lib/export";
import { costingColumns } from "@/lib/columns";

const CStatus = ({ s }: { s: CostingStatus }) => <Badge tone={COSTING_STATUS_TONE[s]}>{COSTING_STATUS_LABEL[s]}</Badge>;
const ACTIVITIES = Object.keys(COSTING_ACTIVITY_LABEL) as CostingActivity[];

function CostingForm({ open, onClose, onSaved, edit }: { open: boolean; onClose: () => void; onSaved: (id?: string) => void; edit?: CostingRow | null }) {
  const lk = useLookups();
  const toast = useToast();
  const blank = {
    tour_code: "", tour_name: "", destination: "", vendor_id: "", supplier_name: "", activity_type: "new_costing", existing_cost: "", updated_cost: "",
    currency: "INR", costing_basis: "per_person", transfer_type: "", season: "", selling_price: "", effective_date: "", assigned_employee_id: "", remarks: "", confirmation_reference: "",
  };
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
  const margin = v.selling_price && v.updated_cost ? Number(v.selling_price) - Number(v.updated_cost) : null;
  const marginPct = margin !== null && Number(v.selling_price) > 0 ? (margin / Number(v.selling_price)) * 100 : null;

  async function save() {
    const parsed = costingSchema.safeParse(v);
    if (!parsed.success) { setErrs(fieldErrors(parsed.error)); return; }
    setErrs({}); setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const res = edit
      ? await sb.from("costing_records").update(parsed.data).eq("id", edit.id).select("id").single()
      : await sb.from("costing_records").insert(parsed.data).select("id").single();
    setBusy(false);
    if (res.error) { setError(errorMessage(res.error)); return; }
    toast("success", edit ? "Costing updated — change recorded in history" : "Costing record created");
    onSaved(res.data.id); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} size="xl" title={edit ? `Edit ${edit.costing_code}` : "New costing / validation record"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{edit ? "Save changes" : "Create"}</Button></>}>
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Tour ID" required error={errs.tour_code}><Input value={v.tour_code} onChange={(e) => set({ tour_code: e.target.value })} /></Field>
        <Field label="Tour name" required error={errs.tour_name} className="lg:col-span-2"><Input value={v.tour_name} onChange={(e) => set({ tour_name: e.target.value })} /></Field>
        <Field label="Destination"><Input value={v.destination} onChange={(e) => set({ destination: e.target.value })} /></Field>
        <Field label="Supplier / DMC (directory)">
          <Select placeholder="—" value={v.vendor_id} onChange={(e) => set({ vendor_id: e.target.value })} options={lk.vendors.filter((x) => x.is_active || x.id === v.vendor_id).map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <Field label="…or supplier name" hint="If not in the vendor directory"><Input value={v.supplier_name} onChange={(e) => set({ supplier_name: e.target.value })} /></Field>
        <Field label="Validation activity" required>
          <Select value={v.activity_type} onChange={(e) => set({ activity_type: e.target.value })} options={ACTIVITIES.map((a) => ({ value: a, label: COSTING_ACTIVITY_LABEL[a] }))} />
        </Field>
        <Field label="Costing basis" required>
          <Select value={v.costing_basis} onChange={(e) => set({ costing_basis: e.target.value })} options={Object.entries(COSTING_BASIS_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Transfer type">
          <Select placeholder="N/A" value={v.transfer_type} onChange={(e) => set({ transfer_type: e.target.value })} options={[{ value: "private", label: "Private" }, { value: "sic", label: "SIC (shared)" }]} />
        </Field>
        <Field label="Currency" required error={errs.currency}><Input maxLength={3} value={v.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Existing database cost" error={errs.existing_cost}><Input type="number" min={0} step="0.01" value={v.existing_cost} onChange={(e) => set({ existing_cost: e.target.value })} /></Field>
        <Field label="Updated supplier cost" error={errs.updated_cost}><Input type="number" min={0} step="0.01" value={v.updated_cost} onChange={(e) => set({ updated_cost: e.target.value })} /></Field>
        <Field label="Selling price" error={errs.selling_price}><Input type="number" min={0} step="0.01" value={v.selling_price} onChange={(e) => set({ selling_price: e.target.value })} /></Field>
        <Field label="Margin (calculated)">
          <div className={cx("rounded-lg px-3 py-2 text-sm ring-1 ring-inset ring-slate-200 dark:ring-slate-700", margin !== null && margin < 0 && "text-red-600")}>
            {margin === null ? "—" : `${fmtMoney(margin, v.currency || "INR")} (${marginPct?.toFixed(1)}%)`}
          </div>
        </Field>
        <Field label="Season"><Input placeholder="e.g. Peak Dec–Jan" value={v.season} onChange={(e) => set({ season: e.target.value })} /></Field>
        <Field label="Effective date"><Input type="date" value={v.effective_date} onChange={(e) => set({ effective_date: e.target.value })} /></Field>
        <Field label="Assigned employee">
          <Select placeholder="—" value={v.assigned_employee_id} onChange={(e) => set({ assigned_employee_id: e.target.value })} options={lk.employees.filter((e) => e.employment_status !== "inactive" || e.id === v.assigned_employee_id).map((e) => ({ value: e.id, label: e.full_name }))} />
        </Field>
        <Field label="Supplier confirmation reference" hint="Required before the manager can approve"><Input value={v.confirmation_reference} onChange={(e) => set({ confirmation_reference: e.target.value })} /></Field>
        <Field label="Remarks" className="sm:col-span-2 lg:col-span-3"><Textarea value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function CostingDrawer({ c, onClose, onChanged, onOpen }: { c: CostingRow; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const me = useProfile();
  const lk = useLookups();
  const toast = useToast();
  const [history, setHistory] = useState<CostingHistory[]>([]);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState<null | { status: CostingStatus; title: string }>(null);
  const [decision, setDecision] = useState<null | boolean>(null);
  const [ref, setRef] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("costing_history").select("*").eq("costing_id", c.id).order("changed_at", { ascending: false });
    setHistory((data as CostingHistory[]) ?? []);
  }, [c.id]);
  useEffect(() => { void load(); setRef(c.confirmation_reference ?? ""); }, [load, c.confirmation_reference]);

  const locked = c.status === "approved" || c.status === "superseded";
  const editable = !locked && c.status !== "pending_approval";
  const next: { s: CostingStatus; label: string }[] = c.status === "pending_approval" ? [{ s: "draft", label: "Withdraw to draft" }]
    : locked ? [] : ([
      { s: "draft", label: "Back to draft" }, { s: "in_validation", label: "Start validation" },
      { s: "pending_supplier", label: "Awaiting supplier" }, { s: "pending_approval", label: "Submit for approval" },
    ] as const).filter((x) => x.s !== c.status);

  async function setStatus(status: CostingStatus, remarks: string) {
    const { error } = await supabaseBrowser().rpc("set_costing_status", { p_costing_id: c.id, p_status: status, p_remarks: remarks || null });
    if (error) { toast("error", errorMessage(error)); return; }
    toast("success", `${c.costing_code} → ${COSTING_STATUS_LABEL[status]}`);
    setPrompt(null); onChanged(); void load();
  }
  async function decide(approve: boolean, remarks: string) {
    const { error } = await supabaseBrowser().rpc("decide_costing", { p_costing_id: c.id, p_approve: approve, p_confirmation_reference: ref || null, p_remarks: remarks || null });
    if (error) { toast("error", errorMessage(error)); return; }
    toast("success", approve ? "Costing approved and locked" : "Costing rejected");
    setDecision(null); onChanged(); void load();
  }
  async function revise() {
    const { data, error } = await supabaseBrowser().rpc("create_costing_revision", { p_costing_id: c.id, p_remarks: "Revision" });
    if (error) { toast("error", errorMessage(error)); return; }
    toast("success", `Revision ${(data as CostingRow).costing_code} created as draft`);
    onChanged(); onOpen((data as CostingRow).id);
  }
  const money = (v: number | null) => fmtMoney(v, c.currency);

  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2"><span className="font-mono text-sm text-slate-500">{c.costing_code}</span><CStatus s={c.status} /></span>}>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{c.tour_name}</h2>
          <p className="text-sm text-slate-500">{c.tour_code} · {c.destination ?? "—"} · {COSTING_ACTIVITY_LABEL[c.activity_type]}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Existing DB cost", money(c.existing_cost)], ["Updated supplier cost", money(c.updated_cost)], ["Selling price", money(c.selling_price)],
            ["Margin", c.margin === null ? "—" : `${money(c.margin)} (${c.margin_pct}%)`]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800"><p className="text-[11px] text-slate-500">{k}</p><p className="text-sm font-semibold">{v}</p></div>
          ))}
        </div>
        {c.cost_change_pct !== null && (
          <p className={cx("flex items-center gap-1 text-sm", c.cost_change_pct > 0 ? "text-red-600" : "text-emerald-600")}>
            {c.cost_change_pct > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}Supplier cost {c.cost_change_pct > 0 ? "increased" : "changed"} {c.cost_change_pct}% vs database
          </p>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {([["Supplier / DMC", c.vendor_name ?? c.supplier_name ?? "—"], ["Basis", COSTING_BASIS_LABEL[c.costing_basis]], ["Transfer", c.transfer_type?.toUpperCase() ?? "—"],
            ["Season", c.season ?? "—"], ["Effective", fmtDate(c.effective_date)], ["Assigned", c.assignee_name ?? "—"],
            ["Confirmation ref", c.confirmation_reference ?? "—"], ["Approved by", c.approved_by_name ?? "—"], ["Approved at", fmtDateTime(c.approved_at)]] as [string, string][])
            .map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {c.remarks && <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">{c.remarks}</p>}
        {c.supersedes_id && <p className="text-sm">Revision of <button className="text-indigo-600 hover:underline" onClick={() => onOpen(c.supersedes_id!)}>previous record</button></p>}
        {c.task_id && <p className="text-sm">Linked task: <Link className="text-indigo-600 hover:underline" href={`/tasks/${c.task_id}`}>open task</Link></p>}

        <Card title="Validation workflow">
          <div className="flex flex-wrap gap-2">
            {next.map((n) => <Button key={n.s} size="sm" variant={n.s === "pending_approval" ? "primary" : "secondary"} onClick={() => setPrompt({ status: n.s, title: n.label })}>{n.label}</Button>)}
            {editable && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit figures</Button>}
            {c.status === "approved" && <Button size="sm" variant="secondary" onClick={revise}><GitBranch className="h-3.5 w-3.5" /> Create revision</Button>}
          </div>
          {c.status === "pending_approval" && me.isManager && (
            <div className="mt-4 space-y-3 rounded-lg border border-violet-200 p-3 dark:border-violet-900">
              <p className="flex items-center gap-1.5 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-violet-500" />Manager decision</p>
              <Field label="Supplier confirmation reference" required hint="Email / contract / rate sheet reference — approval is impossible without it">
                <Input value={ref} onChange={(e) => setRef(e.target.value)} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="danger" onClick={() => setDecision(false)}>Reject</Button>
                <Button size="sm" variant="success" disabled={!ref.trim()} onClick={() => setDecision(true)}>Approve</Button>
              </div>
            </div>
          )}
          {locked && <p className="mt-2 text-xs text-slate-500">Approved costing is locked. Changes require a new revision, which goes through validation again.</p>}
        </Card>

        <Card title="Supporting documents"><Attachments kind="costing" entityId={c.id} readOnly={locked && !me.isManager} /></Card>

        <Card title="Change history">
          <ol className="space-y-3 text-xs">
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                <p><span className="font-medium">{lk.profileById.get(h.changed_by ?? "")?.full_name ?? "System"}</span> · {h.action.replace("status:", "status → ").replace("_", " ")} <span className="text-slate-400">· {fmtDateTime(h.changed_at)}</span></p>
                {h.changed_fields && h.changed_fields.filter((f) => !["status", "approved_by", "approved_at"].includes(f)).map((f) => (
                  <p key={f} className="text-slate-500">{f.replace(/_/g, " ")}: <s>{String(h.old_values?.[f] ?? "—")}</s> → <b>{String(h.new_values?.[f] ?? "—")}</b></p>
                ))}
                {h.remarks && <p className="italic text-slate-500">“{h.remarks}”</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <CostingForm open={editing} edit={c} onClose={() => setEditing(false)} onSaved={() => { onChanged(); void load(); }} />
      <PromptDialog open={!!prompt} title={prompt?.title ?? ""} onCancel={() => setPrompt(null)} onConfirm={(r) => setStatus(prompt!.status, r)} />
      <PromptDialog open={decision !== null} title={decision ? "Approve costing" : "Reject costing"} required={decision === false}
        variant={decision ? "success" : "danger"} confirmText={decision ? "Approve" : "Reject"}
        description={decision ? `Confirmation reference: ${ref}. The record will be locked.` : "Explain what needs to be corrected."}
        onCancel={() => setDecision(null)} onConfirm={(r) => decide(!!decision, r)} />
    </Drawer>
  );
}

function Costing() {
  const lk = useLookups();
  const params = useSearchParams();
  const router = useRouter();
  const [rows, setRows] = useState<CostingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ q: "", status: "", activity: "", assignee: "", hideSuperseded: true });
  const [creating, setCreating] = useState(false);
  const openId = params.get("open");

  const load = useCallback(async () => {
    try {
      const sb = supabaseBrowser();
      setRows(await fetchAll<CostingRow>((a, b) => sb.from("costing_overview").select("*").order("updated_at", { ascending: false }).range(a, b)));
      setError(null);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (f.hideSuperseded && r.status === "superseded" && !f.status) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.activity && r.activity_type !== f.activity) return false;
    if (f.assignee && r.assigned_employee_id !== f.assignee) return false;
    const q = f.q.trim().toLowerCase();
    return !q || `${r.costing_code} ${r.tour_code} ${r.tour_name} ${r.destination ?? ""} ${r.vendor_name ?? ""} ${r.supplier_name ?? ""}`.toLowerCase().includes(q);
  }), [rows, f]);
  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === "pending_approval").length,
    validating: rows.filter((r) => ["in_validation", "pending_supplier", "draft"].includes(r.status)).length,
    negative: rows.filter((r) => r.margin !== null && r.margin < 0 && r.status !== "superseded").length,
    approved: rows.filter((r) => r.status === "approved").length,
  }), [rows]);
  const selected = rows.find((r) => r.id === openId) ?? null;
  const setOpen = (id: string | null) => router.replace(id ? `/costing?open=${id}` : "/costing", { scroll: false });

  return (
    <>
      <PageHeader title="Costing & Product Validation" subtitle="Validation workflow for supplier costs, selling prices and margins"
        actions={<>
          <Button variant="secondary" onClick={() => exportCSV({ title: "Costing activity" }, costingColumns, filtered)}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => exportXLSX({ title: "Costing activity" }, costingColumns, filtered)}><Download className="h-4 w-4" /> Excel</Button>
          <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New costing</Button>
        </>} />
      <div className="mb-4 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        This tracker records the validation workflow only. It never writes to the production pricing database, and no costing counts as approved until the manager approves it with a supplier confirmation reference.
      </div>
      <ErrorBanner message={error} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Awaiting approval", counts.pending, "text-violet-600", "pending_approval"], ["In validation", counts.validating, "text-blue-600", ""], ["Negative margin", counts.negative, "text-red-600", ""], ["Approved (current)", counts.approved, "text-emerald-600", "approved"]].map(([l, v, c, s]) => (
          <button key={l as string} onClick={() => s && setF({ ...f, status: s as string })} className="rounded-xl border border-slate-200 bg-white p-3 text-left dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500">{l}</p><p className={cx("text-xl font-semibold tabular-nums", c as string)}>{v}</p>
          </button>
        ))}
      </div>
      <Card>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
          <Input className="col-span-2 sm:col-span-3 lg:w-56" placeholder="Search tour, supplier…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <Select className="lg:w-44" placeholder="All statuses" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={Object.entries(COSTING_STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select className="lg:w-60" placeholder="All activities" value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} options={ACTIVITIES.map((a) => ({ value: a, label: COSTING_ACTIVITY_LABEL[a] }))} />
          <Select className="lg:w-44" placeholder="Any employee" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} options={lk.employees.map((e) => ({ value: e.id, label: e.full_name }))} />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={f.hideSuperseded} onChange={(e) => setF({ ...f, hideSuperseded: e.target.checked })} /> Hide superseded</label>
        </div>
        {loading ? <Spinner /> : filtered.length === 0 ? <EmptyState title="No costing records" /> : (
          <Table>
            <thead><tr><Th>ID</Th><Th>Tour</Th><Th>Supplier</Th><Th>Activity</Th><Th className="text-right">DB cost</Th><Th className="text-right">Supplier cost</Th><Th className="text-right">Selling</Th><Th className="text-right">Margin</Th><Th>Assigned</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td className="whitespace-nowrap font-mono text-xs text-indigo-600 dark:text-indigo-400">{r.costing_code}</Td>
                  <Td className="min-w-48"><p className="font-medium text-slate-900 dark:text-slate-100">{r.tour_name}</p><p className="text-xs text-slate-500">{r.tour_code} · {r.destination ?? "—"} · {COSTING_BASIS_LABEL[r.costing_basis]}{r.transfer_type && ` · ${r.transfer_type.toUpperCase()}`}</p></Td>
                  <Td className="whitespace-nowrap">{r.vendor_name ?? r.supplier_name ?? "—"}</Td>
                  <Td className="text-xs">{COSTING_ACTIVITY_LABEL[r.activity_type]}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{fmtMoney(r.existing_cost, r.currency)}</Td>
                  <Td className={cx("whitespace-nowrap text-right tabular-nums", (r.cost_change_pct ?? 0) > 0 && "text-red-600")}>{fmtMoney(r.updated_cost, r.currency)}{r.cost_change_pct !== null && <span className="block text-[11px]">{r.cost_change_pct > 0 ? "+" : ""}{r.cost_change_pct}%</span>}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{fmtMoney(r.selling_price, r.currency)}</Td>
                  <Td className={cx("whitespace-nowrap text-right tabular-nums", r.margin !== null && r.margin < 0 && "font-semibold text-red-600")}>{r.margin_pct === null ? "—" : `${r.margin_pct}%`}</Td>
                  <Td className="whitespace-nowrap">{r.assignee_name ?? "—"}</Td>
                  <Td><CStatus s={r.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <CostingForm open={creating} onClose={() => setCreating(false)} onSaved={(id) => { void load(); if (id) setOpen(id); }} />
      {selected && <CostingDrawer c={selected} onClose={() => setOpen(null)} onChanged={load} onOpen={(id) => setOpen(id)} />}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><Costing /></Suspense>;
}
