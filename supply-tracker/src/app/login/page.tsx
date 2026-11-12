"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Lock } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Field, Input, ErrorBanner } from "@/components/ui";
import { errorMessage } from "@/lib/errors";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "inactive" ? "Your account is not active for the Supply Team Portal. Contact the administrator." : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Incorrect email or password." : errorMessage(error));
      setBusy(false);
      return;
    }
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <Field label="Work email" required>
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" required>
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Button type="submit" className="w-full" loading={busy}><Lock className="h-4 w-4" /> Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-sky-50 px-4 py-12 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"><Boxes className="h-6 w-6" /></span>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Supply Team Portal</h1>
          <p className="mt-1 text-sm text-slate-500">Restricted to Supply Team management</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Suspense><LoginForm /></Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">Accounts are issued by the portal administrator.</p>
      </div>
    </div>
  );
}
