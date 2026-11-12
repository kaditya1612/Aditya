"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useLookups, useProfile } from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { AppRole, Profile, RecurringTask } from "@/lib/types";
import { Badge, Button, Card, ErrorBanner, Field, Input, Modal, PageHeader, Select, Table, Tabs, Td, Th, Textarea, useToast } from "@/components/ui";
import { PRIORITIES, PRIORITY_LABEL, REQ_TYPES, REQ_TYPE_LABEL, ROLE_LABEL } from "@/lib/constants";
import { errorMessage } from "@/lib/errors";
import { fmtDate } from "@/lib/format";

type TabKey = "users" | "categories" | "org" | "rules" | "recurring" | "notifications";

// ---------------------------------------------------------------------------
function UsersTab() {
  const lk = useLookups();
  const me = useProfile();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ email: "", full_name: "", role: "leader" as AppRole, team_id: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwFor, setPwFor] = useState<Profile | null>(null);
  const [pw, setPw] = useState("");

  async function api(method: "POST" | "PATCH", body: unknown) {
    const res = await fetch("/api/admin/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }
  async function create() {
    setBusy(true); setError(null);
    try {
      await api("POST", { ...v, team_id: v.team_id || null });
      toast("success", `${v.full_name} can now sign in`);
      setOpen(false); setV({ email: "", full_name: "", role: "leader", team_id: "", password: "" });
      await lk.refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function update(p: Profile, patch: Partial<Pick<Profile, "role" | "team_id">>) {
    const { error } = await supabaseBrowser().from("profiles").update(patch).eq("id", p.id);
    if (error) toast("error", errorMessage(error)); else { toast("success", "User updated"); await lk.refresh(); }
  }
  async function toggleActive(p: Profile) {
    try { await api("PATCH", { id: p.id, is_active: !p.is_active }); toast("success", p.is_active ? "Access revoked" : "Access restored"); await lk.refresh(); }
    catch (e) { toast("error", errorMessage(e)); }
  }

  return (
    <Card title="Portal users" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add user</Button>}>
      <p className="mb-3 text-xs text-slate-500">Only management roles sign in. Supply Team employees are task owners in the directory and don&apos;t need accounts. Sales and Operations never get access.</p>
      <Table>
        <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Team</Th><Th>Status</Th><Th>Since</Th><Th /></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {lk.profiles.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.full_name}{p.id === me.id && <Badge tone="indigo" className="ml-1">you</Badge>}</Td>
              <Td className="text-xs">{p.email}</Td>
              <Td><Select className="w-48" value={p.role} disabled={p.id === me.id} onChange={(e) => update(p, { role: e.target.value as AppRole })}
                options={(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Td>
              <Td><Select className="w-40" placeholder="—" value={p.team_id ?? ""} onChange={(e) => update(p, { team_id: e.target.value || null })} options={lk.teams.map((t) => ({ value: t.id, label: t.name }))} /></Td>
              <Td><Badge tone={p.is_active ? "green" : "zinc"}>{p.is_active ? "Active" : "Inactive"}</Badge></Td>
              <Td className="text-xs">{fmtDate(p.created_at)}</Td>
              <Td className="whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => { setPwFor(p); setPw(""); }}>Reset password</Button>
                {p.id !== me.id && <Button size="sm" variant={p.is_active ? "ghost" : "secondary"} onClick={() => toggleActive(p)}>{p.is_active ? "Deactivate" : "Activate"}</Button>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="Add portal user" size="sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={create}>Create user</Button></>}>
        <ErrorBanner message={error} />
        <div className="space-y-3">
          <Field label="Full name" required><Input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
          <Field label="Work email" required><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label="Role" required><Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as AppRole })} options={(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
          <Field label="Team" hint="Team Leaders only see employees of their team"><Select placeholder="—" value={v.team_id} onChange={(e) => setV({ ...v, team_id: e.target.value })} options={lk.teams.map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Temporary password" required hint="At least 10 characters — share it securely"><Input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`Reset password — ${pwFor?.full_name}`} size="sm"
        footer={<><Button variant="secondary" onClick={() => setPwFor(null)}>Cancel</Button>
          <Button disabled={pw.length < 10} onClick={async () => { try { await api("PATCH", { id: pwFor!.id, password: pw }); toast("success", "Password updated"); setPwFor(null); } catch (e) { toast("error", errorMessage(e)); } }}>Set password</Button></>}>
        <Field label="New password" hint="At least 10 characters"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function CategoriesTab() {
  const lk = useLookups();
  const toast = useToast();
  const [newCat, setNewCat] = useState<Record<string, { name: string; hours: string }>>({});
  const [group, setGroup] = useState({ code: "", name: "" });
  const sb = supabaseBrowser();
  const run = async (p: PromiseLike<{ error: unknown }>, msg: string) => {
    const { error } = await p;
    if (error) toast("error", errorMessage(error)); else { toast("success", msg); await lk.refresh(); }
  };
  return (
    <div className="space-y-4">
      {lk.groups.map((g) => (
        <Card key={g.id} title={`${g.code}. ${g.name}`}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {lk.categories.filter((c) => c.group_id === g.id).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className={c.is_active ? "flex-1" : "flex-1 text-slate-400 line-through"}>{c.name}</span>
                <label className="flex items-center gap-1 text-xs text-slate-500">Default effort
                  <Input className="w-20" type="number" min={0} step={0.5} defaultValue={c.default_effort_hours ?? ""}
                    onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== c.default_effort_hours) void run(sb.from("task_categories").update({ default_effort_hours: v }).eq("id", c.id), "Saved"); }} />h
                </label>
                <Button size="sm" variant="ghost" onClick={() => run(sb.from("task_categories").update({ is_active: !c.is_active }).eq("id", c.id), c.is_active ? "Category retired" : "Category restored")}>
                  {c.is_active ? "Retire" : "Restore"}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input className="flex-1" placeholder="New category name" value={newCat[g.id]?.name ?? ""} onChange={(e) => setNewCat({ ...newCat, [g.id]: { name: e.target.value, hours: newCat[g.id]?.hours ?? "" } })} />
            <Input className="w-28" type="number" placeholder="Hours" value={newCat[g.id]?.hours ?? ""} onChange={(e) => setNewCat({ ...newCat, [g.id]: { name: newCat[g.id]?.name ?? "", hours: e.target.value } })} />
            <Button size="sm" disabled={!newCat[g.id]?.name?.trim()} onClick={async () => {
              const n = newCat[g.id]!;
              await run(sb.from("task_categories").insert({ group_id: g.id, name: n.name.trim(), default_effort_hours: n.hours ? Number(n.hours) : null, sort_order: 100 }), "Category added");
              setNewCat({ ...newCat, [g.id]: { name: "", hours: "" } });
            }}><Plus className="h-4 w-4" /> Add</Button>
          </div>
        </Card>
      ))}
      <Card title="Add category group">
        <div className="flex flex-wrap gap-2">
          <Input className="w-24" placeholder="Code (G)" maxLength={3} value={group.code} onChange={(e) => setGroup({ ...group, code: e.target.value.toUpperCase() })} />
          <Input className="flex-1" placeholder="Group name" value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} />
          <Button disabled={!group.code || !group.name} onClick={async () => { await run(sb.from("task_category_groups").insert({ ...group, sort_order: lk.groups.length + 1 }), "Group added"); setGroup({ code: "", name: "" }); }}>Add group</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function OrgTab() {
  const lk = useLookups();
  const toast = useToast();
  const sb = supabaseBrowser();
  const [team, setTeam] = useState("");
  const [dept, setDept] = useState("");
  const run = async (p: PromiseLike<{ error: unknown }>, msg: string) => {
    const { error } = await p;
    if (error) toast("error", errorMessage(error)); else { toast("success", msg); await lk.refresh(); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Supply teams">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {lk.teams.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="flex-1 font-medium">{t.name}</span>
              <Select className="w-48" placeholder="No leader" value={t.leader_id ?? ""} onChange={(e) => run(sb.from("teams").update({ leader_id: e.target.value || null }).eq("id", t.id), "Leader set")}
                options={lk.profiles.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.full_name }))} />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2"><Input placeholder="New team" value={team} onChange={(e) => setTeam(e.target.value)} />
          <Button disabled={!team.trim()} onClick={async () => { await run(sb.from("teams").insert({ name: team.trim() }), "Team added"); setTeam(""); }}>Add</Button></div>
      </Card>
      <Card title="Requesting departments">
        <p className="mb-2 text-xs text-slate-500">Departments that raise requirements. They are recorded on requirements only — they have no portal access.</p>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {lk.departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 text-sm">
              <span className={d.is_active ? "" : "text-slate-400 line-through"}>{d.name}</span>
              <Button size="sm" variant="ghost" onClick={() => run(sb.from("requesting_departments").update({ is_active: !d.is_active }).eq("id", d.id), "Updated")}>{d.is_active ? "Retire" : "Restore"}</Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2"><Input placeholder="New department" value={dept} onChange={(e) => setDept(e.target.value)} />
          <Button disabled={!dept.trim()} onClick={async () => { await run(sb.from("requesting_departments").insert({ name: dept.trim() }), "Department added"); setDept(""); }}>Add</Button></div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function RulesTab() {
  const lk = useLookups();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { setDrafts(Object.fromEntries(lk.settingRows.map((r) => [r.key, JSON.stringify(r.value)]))); }, [lk.settingRows]);
  async function save(key: string) {
    let value: unknown;
    try { value = JSON.parse(drafts[key] ?? ""); } catch { toast("error", "Invalid value — use JSON (numbers, \"text\" or {\"key\": 1})"); return; }
    const { error } = await supabaseBrowser().from("app_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    if (error) toast("error", errorMessage(error)); else { toast("success", "Setting saved"); await lk.refresh(); }
  }
  return (
    <Card title="Workload, scoring and business rules">
      <div className="space-y-4">
        {lk.settingRows.map((r) => (
          <div key={r.key} className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-start">
            <div><p className="font-mono text-xs font-medium">{r.key}</p></div>
            <div><Input value={drafts[r.key] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.key]: e.target.value })} className="font-mono text-xs" />
              {r.description && <p className="mt-1 text-xs text-slate-500">{r.description}</p>}</div>
            <Button size="sm" variant="secondary" disabled={drafts[r.key] === JSON.stringify(r.value)} onClick={() => save(r.key)}>Save</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function RecurringTab() {
  const lk = useLookups();
  const toast = useToast();
  const [items, setItems] = useState<RecurringTask[]>([]);
  const [open, setOpen] = useState(false);
  const blank = { title: "", description: "", category_id: "", owner_id: "", priority: "medium", requirement_type: "standard", estimated_hours: "", frequency: "daily", due_time: "18:00", next_run_on: new Date().toISOString().slice(0, 10) };
  const [v, setV] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("recurring_tasks").select("*").order("created_at");
    setItems((data as RecurringTask[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function create() {
    if (!v.title || !v.category_id || !v.owner_id) { setError("Title, category and owner are required"); return; }
    const { error } = await supabaseBrowser().from("recurring_tasks").insert({ ...v, estimated_hours: v.estimated_hours ? Number(v.estimated_hours) : null, description: v.description || null });
    if (error) { setError(errorMessage(error)); return; }
    toast("success", "Recurring task scheduled"); setOpen(false); setV(blank); void load();
  }
  return (
    <Card title="Recurring tasks" actions={<Button size="sm" onClick={() => { setError(null); setOpen(true); }}><Plus className="h-4 w-4" /> New template</Button>}>
      <p className="mb-3 text-xs text-slate-500">Generated automatically each day by the scheduler (e.g. daily reports, weekly rate checks).</p>
      <Table>
        <thead><tr><Th>Task</Th><Th>Owner</Th><Th>Frequency</Th><Th>Next run</Th><Th>Status</Th><Th /></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((r) => (
            <tr key={r.id}>
              <Td><p className="font-medium">{r.title}</p><p className="text-xs text-slate-500">{lk.categoryById.get(r.category_id)?.name}</p></Td>
              <Td>{lk.employeeById.get(r.owner_id)?.full_name ?? "—"}</Td>
              <Td className="capitalize">{r.frequency} · due {r.due_time.slice(0, 5)}</Td>
              <Td>{fmtDate(r.next_run_on)}</Td>
              <Td><Badge tone={r.is_active ? "green" : "zinc"}>{r.is_active ? "Active" : "Paused"}</Badge></Td>
              <Td><Button size="sm" variant="ghost" onClick={async () => { const { error } = await supabaseBrowser().from("recurring_tasks").update({ is_active: !r.is_active }).eq("id", r.id); if (error) toast("error", errorMessage(error)); void load(); }}>{r.is_active ? "Pause" : "Resume"}</Button></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="New recurring task" size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create}>Create</Button></>}>
        <ErrorBanner message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <Field label="Category" required><Select placeholder="Select…" value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}
            options={lk.groups.flatMap((g) => lk.categories.filter((c) => c.group_id === g.id && c.is_active).map((c) => ({ value: c.id, label: `${g.code} · ${c.name}` })))} /></Field>
          <Field label="Owner" required><Select placeholder="Select…" value={v.owner_id} onChange={(e) => setV({ ...v, owner_id: e.target.value })} options={lk.employees.filter((e) => e.employment_status === "active").map((e) => ({ value: e.id, label: e.full_name }))} /></Field>
          <Field label="Priority"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} /></Field>
          <Field label="Requirement type"><Select value={v.requirement_type} onChange={(e) => setV({ ...v, requirement_type: e.target.value })} options={REQ_TYPES.map((p) => ({ value: p, label: REQ_TYPE_LABEL[p] }))} /></Field>
          <Field label="Frequency"><Select value={v.frequency} onChange={(e) => setV({ ...v, frequency: e.target.value })} options={["daily", "weekly", "monthly"].map((f) => ({ value: f, label: f[0]!.toUpperCase() + f.slice(1) }))} /></Field>
          <Field label="Due time"><Input type="time" value={v.due_time} onChange={(e) => setV({ ...v, due_time: e.target.value })} /></Field>
          <Field label="First run date"><Input type="date" value={v.next_run_on} onChange={(e) => setV({ ...v, next_run_on: e.target.value })} /></Field>
          <Field label="Estimated hours"><Input type="number" min={0} step={0.5} value={v.estimated_hours} onChange={(e) => setV({ ...v, estimated_hours: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
const EMAIL_TYPES: [string, string][] = [
  ["critical_escalation", "Critical task escalations"], ["overdue", "Overdue tasks"], ["approval_request", "Approval requests"],
  ["task_assigned", "New task assignments"], ["task_reassigned", "Task reassignments"], ["due_shortly", "Due within 3 hours"],
  ["upcoming_deadline", "Due within 24 hours"], ["pending_supplier", "Pending supplier responses"], ["task_completed", "Task completions"],
  ["new_requirement", "New requirements"], ["requirement_delayed", "Requirements past due"],
];
function NotificationsTab() {
  const me = useProfile();
  const toast = useToast();
  const [s, setS] = useState<{ email_enabled: boolean; email_types: string[] } | null>(null);
  useEffect(() => {
    void supabaseBrowser().from("notification_settings").select("email_enabled, email_types").eq("profile_id", me.id).maybeSingle()
      .then(({ data }) => setS(data ?? { email_enabled: false, email_types: [] }));
  }, [me.id]);
  if (!s) return null;
  async function save(next: typeof s) {
    setS(next);
    const { error } = await supabaseBrowser().from("notification_settings").update(next!).eq("profile_id", me.id);
    if (error) toast("error", errorMessage(error)); else toast("success", "Preferences saved");
  }
  return (
    <Card title="Email notifications">
      <p className="mb-3 text-sm text-slate-500">In-app notifications are always on. Managers and administrators can additionally receive email digests (sent by the scheduled job; requires RESEND_API_KEY on the server).</p>
      <label className="mb-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={s.email_enabled} onChange={(e) => save({ ...s, email_enabled: e.target.checked })} /> Email me about:</label>
      <div className="grid gap-2 sm:grid-cols-2">
        {EMAIL_TYPES.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!s.email_enabled} checked={s.email_types.includes(k)}
              onChange={(e) => save({ ...s, email_types: e.target.checked ? [...s.email_types, k] : s.email_types.filter((x) => x !== k) })} />{label}
          </label>
        ))}
      </div>
    </Card>
  );
}

export default function Settings() {
  const me = useProfile();
  const tabs: { key: TabKey; label: string }[] = [
    ...(me.isAdmin ? [{ key: "users" as const, label: "Users & access" }, { key: "categories" as const, label: "Task categories" }, { key: "org" as const, label: "Teams & departments" }, { key: "rules" as const, label: "Rules & thresholds" }] : []),
    ...(me.isManager ? [{ key: "recurring" as const, label: "Recurring tasks" }, { key: "notifications" as const, label: "Email notifications" }] : []),
  ];
  const [tab, setTab] = useState<TabKey>(tabs[0]?.key ?? "users");
  return (
    <>
      <PageHeader title="Settings" subtitle="System configuration" />
      {tabs.length === 0 ? (
        <Card><p className="text-sm text-slate-500">You are signed in as a Supply Team Leader. System settings are managed by the Supply Team Manager and Administrators.</p></Card>
      ) : (
        <>
          <Tabs value={tab} onChange={setTab} tabs={tabs} />
          {tab === "users" && <UsersTab />}
          {tab === "categories" && <CategoriesTab />}
          {tab === "org" && <OrgTab />}
          {tab === "rules" && <RulesTab />}
          {tab === "recurring" && <RecurringTab />}
          {tab === "notifications" && <NotificationsTab />}
        </>
      )}
    </>
  );
}
