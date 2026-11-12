"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Star } from "lucide-react";
import { useLookups } from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TaskRow, Vendor } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, Th, useToast } from "@/components/ui";
import GroupWorkspace from "@/components/tasks/GroupWorkspace";
import { fieldErrors, vendorSchema } from "@/lib/validation";
import { errorMessage } from "@/lib/errors";
import { fmtRelative } from "@/lib/format";

const TYPES = ["DMC", "Supplier", "Transfer", "Hotel", "Activity", "Other"];

function VendorForm({ open, edit, onClose, onSaved }: { open: boolean; edit: Vendor | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const blank = { vendor_code: "", name: "", vendor_type: "DMC", destination: "", country: "", contact_name: "", contact_email: "", contact_phone: "", performance_rating: "", is_active: true, notes: "" };
  const [v, setV] = useState(blank);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrs({}); setError(null);
    setV(edit ? { ...blank, ...Object.fromEntries(Object.entries(edit).map(([k, x]) => [k, x === null ? "" : typeof x === "boolean" ? x : String(x)])) } as typeof blank : blank);
  }, [open, edit]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<typeof blank>) => setV((s) => ({ ...s, ...p }));
  async function save() {
    const parsed = vendorSchema.safeParse(v);
    if (!parsed.success) { setErrs(fieldErrors(parsed.error)); return; }
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const res = edit ? await sb.from("vendors").update(parsed.data).eq("id", edit.id) : await sb.from("vendors").insert(parsed.data);
    setBusy(false);
    if (res.error) { setError(errorMessage(res.error)); return; }
    toast("success", edit ? "Vendor updated" : "Vendor added");
    onSaved(); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={edit ? `Edit ${edit.name}` : "Add supplier / DMC"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={errs.name}><Input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Vendor code"><Input value={v.vendor_code} onChange={(e) => set({ vendor_code: e.target.value })} /></Field>
        <Field label="Type"><Select value={v.vendor_type} onChange={(e) => set({ vendor_type: e.target.value })} options={TYPES.map((t) => ({ value: t, label: t }))} /></Field>
        <Field label="Performance rating" hint="1 (poor) – 5 (excellent)">
          <Select placeholder="Not rated" value={v.performance_rating} onChange={(e) => set({ performance_rating: e.target.value })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) }))} />
        </Field>
        <Field label="Destination"><Input value={v.destination} onChange={(e) => set({ destination: e.target.value })} /></Field>
        <Field label="Country"><Input value={v.country} onChange={(e) => set({ country: e.target.value })} /></Field>
        <Field label="Contact person"><Input value={v.contact_name} onChange={(e) => set({ contact_name: e.target.value })} /></Field>
        <Field label="Contact email" error={errs.contact_email}><Input type="email" value={v.contact_email} onChange={(e) => set({ contact_email: e.target.value })} /></Field>
        <Field label="Contact phone"><Input value={v.contact_phone} onChange={(e) => set({ contact_phone: e.target.value })} /></Field>
        <Field label="Status"><Select value={v.is_active ? "1" : "0"} onChange={(e) => set({ is_active: e.target.value === "1" })} options={[{ value: "1", label: "Active" }, { value: "0", label: "Inactive" }]} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function Vendors() {
  const lk = useLookups();
  const [tab, setTab] = useState<"directory" | "tasks">("directory");
  const [edit, setEdit] = useState<Vendor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState("");
  const [waiting, setWaiting] = useState<TaskRow[]>([]);
  useEffect(() => {
    void supabaseBrowser().from("task_overview").select("*").eq("status", "pending_supplier").order("updated_at").then(({ data }) => setWaiting((data as TaskRow[]) ?? []));
  }, []);
  const vendors = useMemo(() => lk.vendors.filter((v) => `${v.name} ${v.destination ?? ""} ${v.country ?? ""} ${v.vendor_code ?? ""}`.toLowerCase().includes(q.toLowerCase())), [lk.vendors, q]);

  return (
    <>
      <PageHeader title="Vendor Management" subtitle="Supplier & DMC directory, follow-ups, rate negotiations and contract validation"
        actions={<Button onClick={() => { setEdit(null); setFormOpen(true); }}><Plus className="h-4 w-4" /> Add vendor</Button>} />
      {waiting.length > 0 && (
        <Card className="mb-4" title={`Pending supplier responses (${waiting.length})`}>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {waiting.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/tasks/${t.id}`} className="font-mono text-xs text-indigo-600">{t.task_code}</Link>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-xs text-slate-500">{t.vendor_name ?? "—"} · {t.owner_name} · waiting since {fmtRelative(t.updated_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "directory", label: `Directory (${lk.vendors.length})` }, { key: "tasks", label: "Vendor & DMC tasks" }]} />
      {tab === "directory" ? (
        <Card>
          <Input className="mb-4 sm:w-72" placeholder="Search vendors…" value={q} onChange={(e) => setQ(e.target.value)} />
          {vendors.length === 0 ? <EmptyState title="No vendors yet">Add your DMCs and suppliers to link them to tasks and costing.</EmptyState> : (
            <Table>
              <thead><tr><Th>Vendor</Th><Th>Type</Th><Th>Destination</Th><Th>Contact</Th><Th>Rating</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <Td><p className="font-medium text-slate-900 dark:text-slate-100">{v.name}</p><p className="text-xs text-slate-500">{v.vendor_code}</p></Td>
                    <Td><Badge tone="blue">{v.vendor_type}</Badge></Td>
                    <Td>{[v.destination, v.country].filter(Boolean).join(", ") || "—"}</Td>
                    <Td className="text-xs">{v.contact_name}<br />{v.contact_email}{v.contact_phone && <><br />{v.contact_phone}</>}</Td>
                    <Td>{v.performance_rating ? <span className="flex text-amber-400">{Array.from({ length: v.performance_rating }, (_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}</span> : "—"}</Td>
                    <Td><Badge tone={v.is_active ? "green" : "zinc"}>{v.is_active ? "Active" : "Inactive"}</Badge></Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => { setEdit(v); setFormOpen(true); }}>Edit</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : <GroupWorkspace groupCodes={["C"]} />}
      <VendorForm open={formOpen} edit={edit} onClose={() => setFormOpen(false)} onSaved={() => void lk.refresh()} />
    </>
  );
}
