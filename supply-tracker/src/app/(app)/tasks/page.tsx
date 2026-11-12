"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Download, RefreshCw } from "lucide-react";
import { Button, Card, PageHeader, Spinner, ErrorBanner } from "@/components/ui";
import { TaskFilterBar, TaskTable } from "@/components/tasks/TaskBits";
import TaskForm from "@/components/tasks/TaskForm";
import { applyTaskFilters, useTaskRows, type TaskFilters } from "@/lib/data";
import { exportCSV, exportXLSX, type Column } from "@/lib/export";
import { taskExportColumns } from "@/components/tasks/taskColumns";
import type { TaskRow } from "@/lib/types";

function AllTasks() {
  const params = useSearchParams();
  const router = useRouter();
  const { rows, loading, error, reload } = useTaskRows();
  const [filters, setFilters] = useState<TaskFilters>({ search: params.get("q") ?? "", status: (params.get("status") as TaskFilters["status"]) ?? "" });
  const [creating, setCreating] = useState(params.get("new") === "1");
  useEffect(() => { setFilters((f) => ({ ...f, search: params.get("q") ?? f.search })); }, [params]);
  const filtered = useMemo(() => applyTaskFilters(rows, filters), [rows, filters]);
  const cols: Column<TaskRow>[] = taskExportColumns;

  return (
    <>
      <PageHeader title="All Tasks" subtitle="Central tracker for every Supply Team task"
        actions={<>
          <Button variant="secondary" onClick={() => reload()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="secondary" onClick={() => exportCSV({ title: "Supply tasks" }, cols, filtered)}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => exportXLSX({ title: "Supply tasks" }, cols, filtered)}><Download className="h-4 w-4" /> Excel</Button>
          <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New task</Button>
        </>} />
      <ErrorBanner message={error} />
      <Card>
        <TaskFilterBar value={filters} onChange={setFilters} />
        {loading ? <Spinner /> : <TaskTable rows={filtered} />}
      </Card>
      <TaskForm open={creating} onClose={() => setCreating(false)} onSaved={(id) => router.push(`/tasks/${id}`)} />
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><AllTasks /></Suspense>;
}
