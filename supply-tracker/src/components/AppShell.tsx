"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, ListChecks, CalendarClock, Inbox, Calculator, Package, Truck, KanbanSquare, Users,
  BarChart3, History, Settings, Bell, Moon, Sun, Menu, X, LogOut, Search, Boxes,
} from "lucide-react";
import { ProfileProvider, LookupsProvider } from "@/lib/data";
import { ToastProvider, cx, Avatar } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ROLE_LABEL } from "@/lib/constants";
import type { Notification, Profile } from "@/lib/types";
import { fmtRelative } from "@/lib/format";

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; managerOnly?: boolean }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "All Tasks", icon: ListChecks },
  { href: "/allocation", label: "Daily Task Allocation", icon: CalendarClock },
  { href: "/requirements", label: "Supply Requirements", icon: Inbox },
  { href: "/costing", label: "Costing & Validation", icon: Calculator },
  { href: "/product", label: "Product Management", icon: Package },
  { href: "/vendors", label: "Vendor Management", icon: Truck },
  { href: "/kanban", label: "Kanban Board", icon: KanbanSquare },
  { href: "/employees", label: "Employee Productivity", icon: Users },
  { href: "/reports", label: "Reports & Analytics", icon: BarChart3 },
  { href: "/audit", label: "Audit History", icon: History, managerOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* private mode */ }
  };
  return { dark, toggle };
}

function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("notifications").select("*")
      .eq("recipient_id", userId).order("created_at", { ascending: false }).limit(30);
    if (data) setItems(data as Notification[]);
  }, [userId]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60000);
    const sb = supabaseBrowser();
    const ch = sb.channel("notif-" + userId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => { clearInterval(t); void sb.removeChannel(ch); };
  }, [load, userId]);

  const unread = items.filter((n) => !n.read_at).length;
  async function openItem(n: Notification) {
    setOpen(false);
    if (!n.read_at) await supabaseBrowser().rpc("mark_notifications_read", { p_ids: [n.id] });
    void load();
    if (n.link) router.push(n.link);
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Notifications (${unread} unread)`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <span className="text-sm font-semibold">Notifications</span>
              <div className="flex gap-3 text-xs">
                {unread > 0 && <button className="text-indigo-600" onClick={async () => { await supabaseBrowser().rpc("mark_notifications_read", { p_ids: null }); void load(); }}>Mark all read</button>}
                <Link href="/notifications" className="text-slate-500" onClick={() => setOpen(false)}>View all</Link>
              </div>
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">You&apos;re all caught up</li>}
              {items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => openItem(n)} className={cx("block w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800", !n.read_at && "bg-indigo-50/60 dark:bg-indigo-950/40")}>
                    <p className={cx("text-sm", !n.read_at && "font-semibold", n.type === "critical_escalation" && "text-red-600")}>{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-slate-500">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-400">{fmtRelative(n.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function AppShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [q, setQ] = useState("");
  const { dark, toggle } = useTheme();
  const isManager = profile.role === "manager" || profile.role === "admin";
  useEffect(() => setMobileOpen(false), [pathname]);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {NAV.filter((n) => !n.managerOnly || isManager).map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link key={n.href} href={n.href}
            className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              active ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white")}>
            <n.icon className="h-[18px] w-[18px] shrink-0" />{n.label}
          </Link>
        );
      })}
    </nav>
  );
  const brand = (
    <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-5 dark:border-slate-800">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white"><Boxes className="h-4 w-4" /></span>
      <div className="leading-tight"><p className="text-sm font-semibold">Supply Hub</p><p className="text-[11px] text-slate-500">Supply Team Portal</p></div>
    </div>
  );

  return (
    <ProfileProvider profile={profile}>
      <LookupsProvider>
        <ToastProvider>
          <div className="flex h-full">
            <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
              {brand}{nav}
              <div className="border-t border-slate-200 p-3 text-[11px] text-slate-400 dark:border-slate-800">Supply Team only · v1.0</div>
            </aside>

            {mobileOpen && (
              <div className="fixed inset-0 z-50 flex lg:hidden">
                <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
                <aside className="relative flex w-72 max-w-[85%] flex-col bg-white dark:bg-slate-900">
                  <button className="absolute right-3 top-3.5 p-1 text-slate-400" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
                  {brand}{nav}
                </aside>
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-5 dark:border-slate-800 dark:bg-slate-900/90">
                <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
                <form className="relative max-w-md flex-1" onSubmit={(e) => { e.preventDefault(); router.push(`/tasks?q=${encodeURIComponent(q)}`); }}>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, IDs, employees…"
                    className="w-full rounded-lg border-0 bg-slate-100 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800 dark:focus:bg-slate-900" />
                </form>
                <div className="ml-auto flex items-center gap-1">
                  <NotificationBell userId={profile.id} />
                  <button onClick={toggle} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Toggle dark mode">
                    {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </button>
                  <div className="ml-1 hidden items-center gap-2 border-l border-slate-200 pl-3 sm:flex dark:border-slate-700">
                    <Avatar name={profile.full_name} />
                    <div className="leading-tight">
                      <p className="text-sm font-medium">{profile.full_name}</p>
                      <p className="text-[11px] text-slate-500">{ROLE_LABEL[profile.role]}</p>
                    </div>
                  </div>
                  <button onClick={signOut} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Sign out" title="Sign out"><LogOut className="h-5 w-5" /></button>
                </div>
              </header>
              <main className="flex-1 overflow-y-auto px-3 py-5 sm:px-6 lg:px-8">{children}</main>
            </div>
          </div>
        </ToastProvider>
      </LookupsProvider>
    </ProfileProvider>
  );
}
