"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { Download, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAll, useProfile } from "@/lib/data";
import type { AuditEntry } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { exportCSV, exportXLSX, type Column } from "@/lib/export";
import { errorMessage } from "@/lib/errors";

const ACTION_GROUPS: Record<string, string[]> = {
  "Task creation": ["task.created"], "Assignment": ["task.assigned", "task.contributors_updated"], "Reassignment": ["task.reassigned"],
  "Priority changes": ["task.priority_changed"], "Deadline changes": ["task.deadline_changed", "task.extension_requested", "task.extension_approved", "task.extension_rejected"],
  "Status changes": ["task.status_changed"], "Approval": ["task.approved", "costing.approved", "requirement.accepted"],
  "Rejection": ["task.rejected", "costing.rejected", "requirement.rejected"], "Closure": ["task.closed", "task.cancelled", "requirement.closed"],
  "Reopening": ["task.reopened"], "Escalation": ["task.escalated"], "Costing validation": ["costing.created", "costing.updated", "costing.validation", "costing.approved", "costing.rejected"],
};
const tone = (a: string) => a.includes("rejected") || a.includes("escalated") || a.includes("cancelled") ? "red"
  : a.includes("approved") || a.includes("closed") ? "green" : a.includes("deadline") || a.includes("extension") ? "orange"
  : a.includes("reassigned") || a.includes("assigned") ? "blue" : a.startsWith("costing") ? "violet" : "slate";

function link(e: AuditEntry) {
  if (!e.entity_id) return null;
  if (e.entity_type === "task") return `/tasks/${e.entity_id}`;
  if (e.entity_type === "requirement") return `/requirements?open=${e.entity_id}`;
  if (e.entity_type === "costing") return `/costing?open=${e.entity_id}`;
  if (e.entity_type === "employee") return `/employees/${e.entity_id}`;
  return null;
}
function describe(d: Record<string, unknown>): string {
  return Object.entries(d).filter(([, v]) => v !== null && v !== "" && v !== undefined).slice(0, 6).map(([k, v]) => {
    if (v && typeof v === "object" && "from" in (v as object)) { const o = v as { from: unknown; to: unknown }; return `${k}: ${String(o.from ?? "—")} → ${String(o.to ?? "—")}`; }
    return `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
  }).join(" · ");
}

export default function Audit() {
  const me = useProfile();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [group, setGroup] = useState("");
  const [entity, setEntity] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      setRows(await fetchAll<AuditEntry>((a, b) => {
        let qb = sb.from("audit_log").select("*").gte("created_at", new Date(`${from}T00:00:00`).toISOString())
          .lte("created_at", new Date(`${to}T23:59:59.999`).toISOString()).order("created_at", { ascending: false }).range(a, b);
        if (group) qb = qb.in("action", ACTION_GROUPS[group]!);
        if (entity) qb = qb.eq("entity_type", entity);
        return qb;
      }));
      setError(null);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, [from, to, group, entity]);
  useEffect(() => { void load(); }, [load]);

  if (!me.isManager) return <ErrorBanner message="The audit history is available to the Supply Team Manager and Administrators." />;
  const shown = rows.filter((r) => !q || `${r.actor_name} ${r.action} ${r.entity_code} ${JSON.stringify(r.details)}`.toLowerCase().includes(q.toLowerCase()));
  const cols: Column<AuditEntry>[] = [
    { header: "Timestamp", value: (r) => fmtDateTime(r.created_at), width: 20 }, { header: "User", value: (r) => r.actor_name, width: 20 },
    { header: "Action", value: (r) => r.action, width: 24 }, { header: "Entity", value: (r) => r.entity_type }, { header: "Reference", value: (r) => r.entity_code, width: 18 },
    { header: "Details", value: (r) => describe(r.details), width: 70 },
  ];

  return (
    <>
      <PageHeader title="Audit History" subtitle={<span className="inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4" />Append-only log — entries cannot be edited or deleted by any user</span>}
        actions={<>
          <Button variant="secondary" onClick={() => exportCSV({ title: "Audit trail", subtitle: `${from} to ${to}` }, cols, shown)}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => exportXLSX({ title: "Audit trail", subtitle: `${from} to ${to}`, generatedBy: me.full_name }, cols, shown)}><Download className="h-4 w-4" /> Excel</Button>
        </>} />
      <ErrorBanner message={error} />
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Action"><Select className="w-48" placeholder="All actions" value={group} onChange={(e) => setGroup(e.target.value)} options={Object.keys(ACTION_GROUPS).map((k) => ({ value: k, label: k }))} /></Field>
          <Field label="Record type"><Select className="w-40" placeholder="All types" value={entity} onChange={(e) => setEntity(e.target.value)}
            options={["task", "requirement", "costing", "employee", "vendor", "user", "category", "team", "setting", "recurring_task"].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="User, ID, details…" /></Field>
        </div>
        {loading ? <Spinner /> : shown.length === 0 ? <EmptyState title="No audit entries for this period" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>User</Th><Th>Action</Th><Th>Record</Th><Th>Details</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.slice(0, 500).map((r) => {
                const href = link(r);
                return (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</Td>
                    <Td className="whitespace-nowrap">{r.actor_name}</Td>
                    <Td><Badge tone={tone(r.action)}>{r.action}</Badge></Td>
                    <Td className="whitespace-nowrap text-xs">{href ? <Link className="text-indigo-600 hover:underline" href={href}>{r.entity_code ?? r.entity_type}</Link> : r.entity_code ?? r.entity_type}</Td>
                    <Td className="max-w-xl text-xs text-slate-500">{describe(r.details)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {shown.length > 500 && <p className="mt-2 text-xs text-slate-500">Showing the latest 500 of {shown.length}. Export for the full list.</p>}
      </Card>
    </>
  );
}
