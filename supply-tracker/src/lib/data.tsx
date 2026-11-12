"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabaseBrowser } from "./supabase/client";
import type {
  AppSetting, Category, CategoryGroup, Department, Employee, Profile, TaskRow, Team, Vendor, TaskStatus, Priority, RequirementType,
} from "./types";
import { settingsFromRows, type MetricSettings, DEFAULT_SETTINGS } from "./metrics";
import { errorMessage } from "./errors";

/** PostgREST caps responses (1000 rows by default) — page through everything. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
    if (out.length > 50000) break; // safety valve
  }
  return out;
}

// ---------------------------------------------------------------------------
// Session profile
// ---------------------------------------------------------------------------
const ProfileCtx = createContext<Profile | null>(null);
export function ProfileProvider({ profile, children }: { profile: Profile; children: ReactNode }) {
  return <ProfileCtx.Provider value={profile}>{children}</ProfileCtx.Provider>;
}
export function useProfile(): Profile & { isManager: boolean; isAdmin: boolean } {
  const p = useContext(ProfileCtx);
  if (!p) throw new Error("useProfile outside ProfileProvider");
  return { ...p, isManager: p.role === "manager" || p.role === "admin", isAdmin: p.role === "admin" };
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export interface Lookups {
  loading: boolean;
  error: string | null;
  employees: Employee[];
  profiles: Profile[];
  categories: Category[];
  groups: CategoryGroup[];
  departments: Department[];
  teams: Team[];
  vendors: Vendor[];
  settings: MetricSettings;
  settingRows: AppSetting[];
  employeeById: Map<string, Employee>;
  profileById: Map<string, Profile>;
  categoryById: Map<string, Category>;
  groupById: Map<string, CategoryGroup>;
  refresh: () => Promise<void>;
}

const LookupsCtx = createContext<Lookups | null>(null);

export function LookupsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Lookups, "refresh" | "employeeById" | "profileById" | "categoryById" | "groupById">>({
    loading: true, error: null, employees: [], profiles: [], categories: [], groups: [], departments: [], teams: [], vendors: [],
    settings: DEFAULT_SETTINGS, settingRows: [],
  });

  const refresh = useCallback(async () => {
    const sb = supabaseBrowser();
    try {
      const [emp, prof, cat, grp, dep, team, ven, set] = await Promise.all([
        sb.from("employees").select("*").order("full_name"),
        sb.from("profiles").select("*").order("full_name"),
        sb.from("task_categories").select("*").order("sort_order"),
        sb.from("task_category_groups").select("*").order("sort_order"),
        sb.from("requesting_departments").select("*").order("name"),
        sb.from("teams").select("*").order("name"),
        sb.from("vendors").select("*").order("name"),
        sb.from("app_settings").select("key,value,description"),
      ]);
      const firstErr = [emp, prof, cat, grp, dep, team, ven, set].find((r) => r.error)?.error;
      if (firstErr) throw firstErr;
      setState({
        loading: false, error: null,
        employees: emp.data as Employee[], profiles: prof.data as Profile[], categories: cat.data as Category[],
        groups: grp.data as CategoryGroup[], departments: dep.data as Department[], teams: team.data as Team[],
        vendors: ven.data as Vendor[], settingRows: set.data as AppSetting[], settings: settingsFromRows(set.data as AppSetting[]),
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e) }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<Lookups>(() => ({
    ...state,
    refresh,
    employeeById: new Map(state.employees.map((e) => [e.id, e])),
    profileById: new Map(state.profiles.map((p) => [p.id, p])),
    categoryById: new Map(state.categories.map((c) => [c.id, c])),
    groupById: new Map(state.groups.map((g) => [g.id, g])),
  }), [state, refresh]);

  return <LookupsCtx.Provider value={value}>{children}</LookupsCtx.Provider>;
}

export function useLookups(): Lookups {
  const v = useContext(LookupsCtx);
  if (!v) throw new Error("useLookups outside LookupsProvider");
  return v;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export interface TaskFilters {
  from?: string;          // ISO date (yyyy-mm-dd)
  to?: string;
  employeeId?: string;
  categoryId?: string;
  groupCode?: string;
  priority?: Priority | "";
  status?: TaskStatus | "" | "open" | "overdue";
  assignedBy?: string;
  requirementType?: RequirementType | "";
  search?: string;
}

/**
 * Loads task_overview rows that had activity in [from, to]: created in range, completed in range,
 * or still open. Everything else is filtered client-side for instant interaction.
 */
export function useTaskRows(range: { from?: string; to?: string } = {}) {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const fromIso = range.from ? new Date(`${range.from}T00:00:00`).toISOString() : null;
      const toIso = range.to ? new Date(`${range.to}T23:59:59.999`).toISOString() : null;
      const data = await fetchAll<TaskRow>((a, b) => {
        let q = sb.from("task_overview").select("*").order("created_at", { ascending: false }).range(a, b);
        if (toIso) q = q.lte("created_at", toIso);
        if (fromIso) q = q.or(`created_at.gte."${fromIso}",completed_at.gte."${fromIso}",status.not.in.(completed,cancelled)`);
        return q;
      });
      setRows(data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, reload: load, setRows };
}

export function applyTaskFilters(rows: TaskRow[], f: TaskFilters): TaskRow[] {
  const s = f.search?.trim().toLowerCase();
  return rows.filter((t) => {
    if (f.employeeId && t.owner_id !== f.employeeId && !t.contributor_ids?.includes(f.employeeId)) return false;
    if (f.categoryId && t.category_id !== f.categoryId) return false;
    if (f.groupCode && t.category_group_code !== f.groupCode) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.requirementType && t.requirement_type !== f.requirementType) return false;
    if (f.assignedBy && t.assigned_by !== f.assignedBy) return false;
    if (f.status === "open") { if (["completed", "cancelled"].includes(t.status)) return false; }
    else if (f.status === "overdue") { if (!t.is_overdue) return false; }
    else if (f.status && t.status !== f.status) return false;
    if (s) {
      const hay = `${t.task_code} ${t.title} ${t.owner_name ?? ""} ${t.category_name} ${t.destination ?? ""} ${t.vendor_name ?? ""} ${t.requirement_code ?? ""}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}
