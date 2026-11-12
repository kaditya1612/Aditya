import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Backup scheduler + email dispatch. pg_cron runs the monitor every 15 minutes inside Supabase;
 * this route (Vercel Cron, or any scheduler sending `Authorization: Bearer $CRON_SECRET`) re-runs it
 * and emails management the notifications they opted into.
 */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const db = supabaseAdmin();
  const monitor = await db.rpc("run_deadline_monitor");
  const recurring = await db.rpc("generate_recurring_tasks");
  if (monitor.error || recurring.error) {
    return NextResponse.json({ error: monitor.error?.message ?? recurring.error?.message }, { status: 500 });
  }

  let emailed = 0;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  if (key && from) {
    const { data: prefs } = await db.from("notification_settings").select("profile_id, email_types").eq("email_enabled", true);
    for (const p of prefs ?? []) {
      const { data: prof } = await db.from("profiles").select("email, full_name, role, is_active").eq("id", p.profile_id).maybeSingle();
      if (!prof?.is_active || !["manager", "admin"].includes(prof.role)) continue;
      const { data: items } = await db.from("notifications").select("id, title, body, link, type, created_at")
        .eq("recipient_id", p.profile_id).is("emailed_at", null).in("type", p.email_types ?? [])
        .gte("created_at", new Date(Date.now() - 2 * 86400000).toISOString()).order("created_at").limit(50);
      if (!items?.length) continue;
      const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
      const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
      const html = `<p>Hello ${esc(prof.full_name)},</p><p>New Supply Team alerts:</p><ul>${items.map((n) =>
        `<li><b>${esc(n.title)}</b>${n.body ? ` — ${esc(n.body)}` : ""}${n.link && site ? ` (<a href="${site}${n.link}">open</a>)` : ""}</li>`).join("")}</ul>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [prof.email], subject: `Supply Portal: ${items.length} alert${items.length > 1 ? "s" : ""}`, html }),
      });
      if (res.ok) {
        await db.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", items.map((n) => n.id));
        emailed += items.length;
      }
    }
  }
  return NextResponse.json({ alerts: monitor.data, recurringCreated: recurring.data, emailed });
}
