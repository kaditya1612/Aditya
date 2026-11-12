"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/lib/data";
import type { Notification } from "@/lib/types";
import { Button, Card, EmptyState, PageHeader, Spinner, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export default function Notifications() {
  const me = useProfile();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const load = useCallback(async () => {
    let q = supabaseBrowser().from("notifications").select("*").eq("recipient_id", me.id).order("created_at", { ascending: false }).limit(300);
    if (unreadOnly) q = q.is("read_at", null);
    const { data } = await q;
    setItems((data as Notification[]) ?? []);
    setLoading(false);
  }, [me.id, unreadOnly]);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <PageHeader title="Notifications" actions={<>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
        <Button variant="secondary" onClick={async () => { await supabaseBrowser().rpc("mark_notifications_read", { p_ids: null }); void load(); }}>Mark all read</Button>
      </>} />
      <Card bodyClass="p-0">
        {loading ? <Spinner /> : items.length === 0 ? <EmptyState title="No notifications" /> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((n) => (
              <li key={n.id} className={cx("flex items-start gap-3 px-4 py-3", !n.read_at && "bg-indigo-50/50 dark:bg-indigo-950/30")}>
                <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : n.type === "critical_escalation" ? "bg-red-500" : "bg-indigo-500")} />
                <div className="min-w-0 flex-1">
                  <p className={cx("text-sm", !n.read_at && "font-semibold")}>{n.link ? <Link href={n.link} className="hover:text-indigo-600"
                    onClick={() => { if (!n.read_at) void supabaseBrowser().rpc("mark_notifications_read", { p_ids: [n.id] }); }}>{n.title}</Link> : n.title}</p>
                  {n.body && <p className="text-sm text-slate-500">{n.body}</p>}
                </div>
                <span className="shrink-0 text-xs text-slate-400">{fmtDateTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
