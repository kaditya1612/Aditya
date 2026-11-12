import { format, formatDistanceToNowStrict } from "date-fns";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso), "dd MMM yyyy");
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso), "dd MMM yyyy, HH:mm");
}
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const s = formatDistanceToNowStrict(d);
  return d.getTime() < Date.now() ? `${s} ago` : `in ${s}`;
}
export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}
export function fmtMoney(v: number | null | undefined, currency = "INR"): string {
  if (v === null || v === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}
/** <input type="datetime-local"> value for an ISO timestamp (local time) */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}
export const todayInput = () => format(new Date(), "yyyy-MM-dd");
export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
