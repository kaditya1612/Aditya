"use client";
import { Button } from "@/components/ui";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-slate-500">{error.message || "Unexpected error"}</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
