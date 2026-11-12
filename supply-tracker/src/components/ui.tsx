"use client";
import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState, isValidElement, cloneElement,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { X, Loader2, Inbox, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import type { Tone } from "@/lib/constants";

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }

// ---------- Button ----------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm disabled:bg-indigo-400",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700",
  ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  danger: "bg-red-600 text-white hover:bg-red-500 shadow-sm",
  success: "bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm",
};
export function Button({ variant = "primary", size = "md", loading, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        VARIANTS[variant], className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// ---------- Form controls ----------
const control = "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 disabled:opacity-60";

export function Field({ label, error, hint, required, children, className }:
  { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  const auto = useId();
  const child = isValidElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>(children) ? children : null;
  const id = child?.props.id ?? auto;
  const descId = `${id}-desc`;
  const control = child
    ? cloneElement(child, { id, "aria-describedby": error || hint ? descId : undefined, "aria-invalid": error ? true : undefined })
    : children;
  return (
    <div className={cx("block", className)}>
      <label htmlFor={child ? id : undefined} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}{required && <span className="text-red-500" aria-hidden="true"> *</span>}
      </label>
      {control}
      {error ? <span id={descId} className="mt-1 block text-xs text-red-600">{error}</span>
        : hint ? <span id={descId} className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </div>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(control, props.className)} />;
}
export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <select {...props} className={cx(control, "pr-8", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ---------- Badge ----------
const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300",
  zinc: "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-950 dark:text-indigo-300",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950 dark:text-orange-300",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300",
};
export function Badge({ tone = "slate", children, className }: { tone?: Tone | string; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone as Tone] ?? TONES.slate, className)}>
      {children}
    </span>
  );
}

// ---------- Card / page chrome ----------
export function Card({ children, className, title, actions, bodyClass }:
  { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; bodyClass?: string }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Inbox className="h-8 w-8 text-slate-300 dark:text-slate-600" />
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {children && <div className="text-xs text-slate-500">{children}</div>}
    </div>
  );
}
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{message}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            value === t.key ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Overlays ----------
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = "md" }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  useEscape(open, onClose);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}
        className={cx("flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900", w)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = "max-w-2xl" }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-[1px]" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()} className={cx("flex h-full w-full flex-col bg-white shadow-2xl dark:bg-slate-900", width)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <div className="min-w-0 text-base font-semibold text-slate-900 dark:text-white">{title}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

// ---------- Toasts ----------
type ToastT = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: ToastT["kind"], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const id = useRef(0);
  const push = useCallback((kind: ToastT["kind"], text: string) => {
    const t = { id: ++id.current, kind, text };
    setToasts((s) => [...s, t]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== t.id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm shadow-lg ring-1",
            t.kind === "success" && "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
            t.kind === "error" && "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
            t.kind === "info" && "bg-white text-slate-800 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700")}>
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Tables ----------
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">{children}</table>
    </div>
  );
}
export function Th({ children, className, onClick, sorted }: { children?: ReactNode; className?: string; onClick?: () => void; sorted?: "asc" | "desc" | null }) {
  return (
    <th onClick={onClick} className={cx("whitespace-nowrap bg-slate-50 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400", onClick && "cursor-pointer select-none hover:text-slate-700", className)}>
      {children}{sorted === "asc" ? " ↑" : sorted === "desc" ? " ↓" : ""}
    </th>
  );
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("px-3 py-2.5 align-top text-slate-700 dark:text-slate-300", className)}>{children}</td>;
}

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  const initials = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  let h = 0;
  for (const c of name ?? "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className={cx("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", className)}
      style={{ backgroundColor: `hsl(${h} 55% 50%)` }} title={name ?? undefined}>{initials}</span>
  );
}

/** Small confirm/prompt dialog with optional mandatory remarks */
export function PromptDialog({ open, title, description, label = "Remarks", required, confirmText = "Confirm", variant = "primary", onCancel, onConfirm, children }:
  { open: boolean; title: string; description?: ReactNode; label?: string; required?: boolean; confirmText?: string; variant?: Variant;
    onCancel: () => void; onConfirm: (remarks: string) => Promise<void> | void; children?: ReactNode }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(""); }, [open]);
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={variant} loading={busy} disabled={required && !text.trim()}
          onClick={async () => { setBusy(true); try { await onConfirm(text.trim()); } finally { setBusy(false); } }}>{confirmText}</Button>
      </>}>
      {description && <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{description}</p>}
      {children}
      <Field label={label} required={required}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={required ? "Required" : "Optional"} />
      </Field>
    </Modal>
  );
}
