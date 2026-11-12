import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <p className="text-slate-600 dark:text-slate-300">This page doesn&apos;t exist.</p>
      <Link href="/dashboard" className="text-sm font-medium text-indigo-600">Back to dashboard</Link>
    </div>
  );
}
