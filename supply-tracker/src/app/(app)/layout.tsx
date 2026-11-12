import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();
  if (!profile || !profile.is_active) {
    await sb.auth.signOut();
    redirect("/login?error=inactive");
  }
  return <AppShell profile={profile}>{children}</AppShell>;
}
