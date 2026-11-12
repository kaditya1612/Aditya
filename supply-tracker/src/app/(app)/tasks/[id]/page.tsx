"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, CheckCheck, Edit3, Send, UserCog, ArrowRightLeft, ShieldAlert, Repeat } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLookups, useProfile } from "@/lib/data";
import type { DeadlineExtension, TaskComment, TaskHistory, TaskRow, CommentKind } from "@/lib/types";
import { Badge, Button, Card, ErrorBanner, Field, Select, Spinner, Textarea, useToast, Avatar, PromptDialog, cx } from "@/components/ui";
import { DeadlineBadge, PriorityBadge, ReqTypeBadge, StatusBadge } from "@/components/tasks/TaskBits";
import { ApprovalDialog, ExtensionDialog, ReassignDialog, StatusDialog } from "@/components/tasks/TaskDialogs";
import TaskForm from "@/components/tasks/TaskForm";
import Attachments from "@/components/Attachments";
import { COMMENT_KIND_LABEL, COMMENT_KIND_TONE, STATUS_LABEL } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtHours, fmtRelative } from "@/lib/format";
import { errorMessage } from "@/lib/errors";

type Entry =
  | { kind: "comment"; at: string; c: TaskComment }
  | { kind: "history"; at: string; h: TaskHistory };

export default function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useProfile();
  const lk = useLookups();
  const toast = useToast();
  const [task, setTask] = useState<TaskRow | null>(null);
  const [history, setHistory] = useState<TaskHistory[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [extensions, setExtensions] = useState<DeadlineExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "status" | "review" | "approve" | "extend" | "reassign" | "edit">(null);
  const [decideExt, setDecideExt] = useState<{ ext: DeadlineExtension; approve: boolean } | null>(null);
  const [kind, setKind] = useState<CommentKind>("remark");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [t, h, c, x] = await Promise.all([
      sb.from("task_overview").select("*").eq("id", id).maybeSingle(),
      sb.from("task_history").select("*").eq("task_id", id).order("changed_at", { ascending: false }),
      sb.from("task_comments").select("*").eq("task_id", id).order("created_at", { ascending: false }),
      sb.from("deadline_extensions").select("*").eq("task_id", id).order("requested_at", { ascending: false }),
    ]);
    if (t.error) setError(errorMessage(t.error));
    else if (!t.data) setError("Task not found, or it is outside your authorised scope.");
    setTask(t.data as TaskRow | null);
    setHistory((h.data as TaskHistory[]) ?? []);
    setComments((c.data as TaskComment[]) ?? []);
    setExtensions((x.data as DeadlineExtension[]) ?? []);
    setLoading(false);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const timeline = useMemo<Entry[]>(() => [
    ...comments.map((c) => ({ kind: "comment" as const, at: c.created_at, c })),
    ...history.map((h) => ({ kind: "history" as const, at: h.changed_at, h })),
  ].sort((a, b) => b.at.localeCompare(a.at)), [comments, history]);

  if (loading) return <Spinner />;
  if (!task) return <ErrorBanner message={error} />;

  const closed = task.status === "completed" || task.status === "cancelled";
  const pendingExt = extensions.find((e) => e.status === "pending");
  const who = (pid: string | null) => (pid ? lk.profileById.get(pid)?.full_name ?? "Unknown user" : "System");

  async function post() {
    if (!body.trim()) return;
    setPosting(true);
    const { error } = await supabaseBrowser().from("task_comments").insert({ task_id: id, kind, body: body.trim(), author_id: me.id });
    setPosting(false);
    if (error) { toast("error", errorMessage(error)); return; }
    setBody(""); setKind("remark");
    void load();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/tasks" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> All tasks</Link>
      <ErrorBanner message={error && task ? null : error} />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-slate-500">{task.task_code}</span>
            <StatusBadge s={task.status} /><PriorityBadge p={task.priority} /><ReqTypeBadge t={task.requirement_type} /><DeadlineBadge s={task.deadline_state} />
            {task.is_escalated && <Badge tone="red"><ShieldAlert className="h-3 w-3" />Escalated</Badge>}
            {task.recurring_task_id && <Badge tone="blue"><Repeat className="h-3 w-3" />Recurring</Badge>}
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{task.title}</h1>
          <p className="text-sm text-slate-500">{task.category_group_name} · {task.category_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!closed && <Button variant="secondary" onClick={() => setDialog("edit")}><Edit3 className="h-4 w-4" /> Edit</Button>}
          {!closed && <Button variant="secondary" onClick={() => setDialog("reassign")}><UserCog className="h-4 w-4" /> Reassign</Button>}
          {!closed && <Button variant="secondary" onClick={() => setDialog("extend")} disabled={!!pendingExt}><CalendarClock className="h-4 w-4" /> {me.isManager ? "Revise deadline" : "Request extension"}</Button>}
          {(!closed || me.isManager) && <Button variant="secondary" onClick={() => setDialog("status")}><ArrowRightLeft className="h-4 w-4" /> Change status</Button>}
          {!closed && task.status !== "awaiting_review" && <Button onClick={() => setDialog("review")}><Send className="h-4 w-4" /> Submit for review</Button>}
          {me.isManager && task.status === "awaiting_review" && <Button variant="success" onClick={() => setDialog("approve")}><CheckCheck className="h-4 w-4" /> Review &amp; approve</Button>}
        </div>
      </div>

      {pendingExt && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200 dark:bg-amber-950 dark:ring-amber-900">
          <div>
            <b>Extension requested</b> by {who(pendingExt.requested_by)} {fmtRelative(pendingExt.requested_at)}: {fmtDateTime(pendingExt.old_due_at)} → <b>{fmtDateTime(pendingExt.proposed_due_at)}</b>
            <p className="text-amber-800 dark:text-amber-300">Reason: {pendingExt.reason}</p>
          </div>
          {me.isManager && (
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={() => setDecideExt({ ext: pendingExt, approve: false })}>Reject</Button>
              <Button size="sm" variant="success" onClick={() => setDecideExt({ ext: pendingExt, approve: true })}>Approve</Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Details">
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{task.description || <span className="text-slate-400">No description.</span>}</p>
            {task.completion_remarks && (
              <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950"><b>Completion remarks:</b> {task.completion_remarks}</div>
            )}
          </Card>

          <Card title="Activity & history" bodyClass="p-0">
            <div className="border-b border-slate-100 p-4 dark:border-slate-800">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select className="sm:w-52" value={kind} onChange={(e) => setKind(e.target.value as CommentKind)}
                  options={(["remark", "progress", "blocker", "supplier_response", "delay_reason", "completion_note"] as CommentKind[]).map((k) => ({ value: k, label: COMMENT_KIND_LABEL[k] }))} />
                <Textarea rows={2} className="flex-1" placeholder="Add a remark, progress update, blocker or supplier response…" value={body} onChange={(e) => setBody(e.target.value)} />
                <Button loading={posting} disabled={!body.trim()} onClick={post} className="self-end">Post</Button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">Entries are permanent and cannot be edited or deleted.</p>
            </div>
            <ol className="divide-y divide-slate-100 dark:divide-slate-800">
              {timeline.map((e) => e.kind === "comment" ? (
                <li key={"c" + e.c.id} className="flex gap-3 px-4 py-3">
                  <Avatar name={who(e.c.author_id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{who(e.c.author_id)}</span>
                      <Badge tone={COMMENT_KIND_TONE[e.c.kind]}>{COMMENT_KIND_LABEL[e.c.kind]}</Badge>
                      <span className="text-slate-400" title={fmtDateTime(e.at)}>{fmtRelative(e.at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{e.c.body}</p>
                  </div>
                </li>
              ) : (
                <li key={"h" + e.h.id} className="flex gap-3 px-4 py-2.5 text-xs text-slate-500">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" style={{ marginLeft: 10, marginRight: 8 }} />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{who(e.h.changed_by)}</span>{" "}
                    {e.h.field === "status" ? (
                      e.h.previous_status
                        ? <>changed status <b>{STATUS_LABEL[e.h.previous_status]}</b> → <b>{STATUS_LABEL[e.h.new_status!]}</b></>
                        : <>created the task as <b>{STATUS_LABEL[e.h.new_status!]}</b></>
                    ) : e.h.field === "deadline" ? (
                      <>revised deadline <b>{fmtDateTime(e.h.old_value)}</b> → <b>{fmtDateTime(e.h.new_value)}</b></>
                    ) : (
                      <>changed {e.h.field.replace("_", " ")} <b>{e.h.old_value ?? "—"}</b> → <b>{e.h.new_value ?? "—"}</b></>
                    )}
                    {e.h.remarks && <span className="italic"> · “{e.h.remarks}”</span>}
                    <span className="ml-1 text-slate-400" title={fmtDateTime(e.at)}>· {fmtDateTime(e.at)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Assignment & dates">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-slate-500">Owner</dt>
              <dd>{task.owner_name ? <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/employees/${task.owner_id}`}>{task.owner_name}</Link> : "—"}</dd>
              <dt className="text-slate-500">Team members</dt><dd>{task.contributor_names.join(", ") || "—"}</dd>
              <dt className="text-slate-500">Assigned by</dt><dd>{task.assigned_by_name ?? "—"}</dd>
              <dt className="text-slate-500">Created</dt><dd>{fmtDateTime(task.created_at)}</dd>
              <dt className="text-slate-500">Start date</dt><dd>{fmtDate(task.start_date)}</dd>
              <dt className="text-slate-500">Original deadline</dt><dd>{fmtDateTime(task.original_due_at)}</dd>
              <dt className="text-slate-500">Current deadline</dt>
              <dd className={cx(task.is_overdue && "font-semibold text-red-600")}>{fmtDateTime(task.due_at)}{task.extension_count > 0 && <Badge tone="orange" className="ml-1">ext ×{task.extension_count}</Badge>}</dd>
              {task.last_delay_reason && <><dt className="text-slate-500">Delay reason</dt><dd>{task.last_delay_reason}</dd></>}
              <dt className="text-slate-500">Estimated</dt><dd>{fmtHours(task.estimated_hours)}</dd>
              <dt className="text-slate-500">Actual</dt><dd>{fmtHours(task.actual_hours)}</dd>
              <dt className="text-slate-500">Submitted</dt><dd>{fmtDateTime(task.submitted_at)}</dd>
              <dt className="text-slate-500">Completed</dt><dd>{fmtDateTime(task.completed_at)}{task.completed_on_time === false && <Badge tone="red" className="ml-1">late</Badge>}</dd>
              <dt className="text-slate-500">Approval</dt>
              <dd className="capitalize">{task.approval_status.replace("_", " ")}{task.approved_by && ` · ${who(task.approved_by)}`}</dd>
              {task.quality_rating && <><dt className="text-slate-500">Quality</dt><dd>{"★".repeat(task.quality_rating)}{"☆".repeat(5 - task.quality_rating)}</dd></>}
              {task.reopen_count > 0 && <><dt className="text-slate-500">Reopened</dt><dd>{task.reopen_count}×</dd></>}
              {task.destination && <><dt className="text-slate-500">Destination</dt><dd>{task.destination}</dd></>}
              {task.vendor_name && <><dt className="text-slate-500">Supplier / DMC</dt><dd>{task.vendor_name}</dd></>}
              {task.requirement_code && <><dt className="text-slate-500">Requirement</dt>
                <dd><Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/requirements?open=${task.requirement_id}`}>{task.requirement_code}</Link></dd></>}
            </dl>
          </Card>

          <Card title="Supporting documents"><Attachments kind="task" entityId={task.id} readOnly={closed && !me.isManager} /></Card>

          {extensions.length > 0 && (
            <Card title="Deadline extensions">
              <ul className="space-y-2 text-xs">
                {extensions.map((x) => (
                  <li key={x.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span>{fmtDateTime(x.old_due_at)} → <b>{fmtDateTime(x.proposed_due_at)}</b></span>
                      <Badge tone={x.status === "approved" ? "green" : x.status === "rejected" ? "red" : "amber"}>{x.status}</Badge>
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">{x.reason}</p>
                    <p className="mt-0.5 text-slate-400">{who(x.requested_by)} · {fmtDateTime(x.requested_at)}{x.decided_by && ` · decided by ${who(x.decided_by)}`}{x.decision_remarks && ` — ${x.decision_remarks}`}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {dialog === "status" && <StatusDialog task={task} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === "review" && <StatusDialog task={task} initial="awaiting_review" onClose={() => setDialog(null)} onDone={load} />}
      {dialog === "approve" && <ApprovalDialog task={task} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === "extend" && <ExtensionDialog task={task} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === "reassign" && <ReassignDialog task={task} onClose={() => setDialog(null)} onDone={load} />}
      <TaskForm open={dialog === "edit"} task={task} onClose={() => setDialog(null)} onSaved={() => void load()} />
      <PromptDialog open={!!decideExt} title={decideExt?.approve ? "Approve extension" : "Reject extension"}
        required={!decideExt?.approve} confirmText={decideExt?.approve ? "Approve" : "Reject"} variant={decideExt?.approve ? "success" : "danger"}
        onCancel={() => setDecideExt(null)}
        onConfirm={async (remarks) => {
          const { error } = await supabaseBrowser().rpc("decide_deadline_extension", { p_extension_id: decideExt!.ext.id, p_approve: decideExt!.approve, p_remarks: remarks || null });
          if (error) { toast("error", errorMessage(error)); return; }
          toast("success", decideExt!.approve ? "Extension approved — deadline revised" : "Extension rejected");
          setDecideExt(null); void load();
        }} />
    </div>
  );
}
