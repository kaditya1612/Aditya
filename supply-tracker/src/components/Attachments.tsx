"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Download, Upload } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ATTACHMENT_BUCKET, MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { Attachment } from "@/lib/types";
import { Button, useToast } from "./ui";
import { errorMessage } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { useLookups } from "@/lib/data";

type Kind = "task" | "requirement" | "costing";
const COLUMN: Record<Kind, "task_id" | "requirement_id" | "costing_id"> = { task: "task_id", requirement: "requirement_id", costing: "costing_id" };

export default function Attachments({ kind, entityId, readOnly }: { kind: Kind; entityId: string; readOnly?: boolean }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const lk = useLookups();

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("task_attachments").select("*").eq(COLUMN[kind], entityId).order("created_at", { ascending: false });
    setItems((data as Attachment[]) ?? []);
  }, [kind, entityId]);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_UPLOAD_BYTES) { toast("error", `${f.name} is larger than 20 MB`); continue; }
        const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-120);
        const path = `${kind}/${entityId}/${crypto.randomUUID()}-${safe}`;
        const up = await sb.storage.from(ATTACHMENT_BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (up.error) throw up.error;
        const { error } = await sb.from("task_attachments").insert({
          [COLUMN[kind]]: entityId, storage_path: path, file_name: f.name, size_bytes: f.size, mime_type: f.type || null, uploaded_by: user?.id,
        });
        if (error) throw error;
      }
      toast("success", "Uploaded");
      await load();
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function open(a: Attachment) {
    const { data, error } = await supabaseBrowser().storage.from(ATTACHMENT_BUCKET).createSignedUrl(a.storage_path, 120, { download: a.file_name });
    if (error) { toast("error", errorMessage(error)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div>
      {!readOnly && (
        <>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}><Upload className="h-3.5 w-3.5" /> Upload documents</Button>
        </>
      )}
      <ul className="mt-3 space-y-1.5">
        {items.length === 0 && <li className="text-xs text-slate-500">No documents yet.</li>}
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-800">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate">{a.file_name}</p>
              <p className="text-[11px] text-slate-500">{lk.profileById.get(a.uploaded_by ?? "")?.full_name ?? "—"} · {fmtDateTime(a.created_at)}{a.size_bytes ? ` · ${(a.size_bytes / 1024).toFixed(0)} KB` : ""}</p>
            </div>
            <button onClick={() => open(a)} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Download ${a.file_name}`}><Download className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
