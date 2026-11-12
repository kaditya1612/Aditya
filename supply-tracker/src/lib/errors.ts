/** Turns Supabase/Postgres errors into messages a manager can act on. */
export function errorMessage(err: unknown): string {
  if (!err) return "Something went wrong";
  const e = err as { message?: string; code?: string; details?: string };
  const msg = e.message ?? String(err);
  if (e.code === "23505") return "A record with this identifier already exists.";
  if (e.code === "23503") return "This record references something that no longer exists.";
  if (e.code === "42501" || /row-level security/i.test(msg)) {
    return /row-level security/i.test(msg) ? "You don't have permission to do that (outside your authorised scope)." : msg;
  }
  if (/permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Network error — check your connection and try again.";
  return msg.replace(/^.*?ERROR:\s*/, "");
}
