import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { newUserSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Confirms the caller is an active administrator, using their own session (RLS applies). */
async function requireAdmin() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: me } = await sb.from("profiles").select("id, role, is_active").eq("id", user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.is_active) {
    return { error: NextResponse.json({ error: "Only administrators can manage portal users" }, { status: 403 }) };
  }
  return { sb, me };
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const parsed = newUserSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { email, full_name, role, team_id, password } = parsed.data;

  // Role lives in app_metadata, which only the service role can write; the DB trigger turns it into an active profile.
  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { role, full_name, team_id: team_id ?? "" },
    user_metadata: { full_name },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.user?.id }, { status: 201 });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(10, "Use at least 10 characters").max(72).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { id, password, is_active } = parsed.data;
  const admin = supabaseAdmin();

  if (is_active !== undefined) {
    if (id === auth.me!.id && !is_active) return NextResponse.json({ error: "You cannot deactivate your own account" }, { status: 400 });
    // profile flag via the admin's own session → audited + last-admin guard enforced by the DB
    const { error } = await auth.sb!.from("profiles").update({ is_active }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    // also block / unblock sign-in at the auth layer
    const { error: e2 } = await admin.auth.admin.updateUserById(id, { ban_duration: is_active ? "none" : "876000h" });
    if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
  }
  if (password) {
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
