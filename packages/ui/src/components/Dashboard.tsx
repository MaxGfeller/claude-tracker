import { useMemo, useState } from "react";
import { usePlans } from "../hooks/usePlans";
import { KanbanColumn } from "./KanbanColumn";
import { Button } from "./ui/button";
import { CreateTaskModal } from "./CreateTaskModal";
import { startAllWork, type Plan } from "../api";
import { PlusIcon } from "lucide-react";

const COLUMNS = [
  { title: "Open", status: "open" },
  { title: "In Progress", status: "in-progress" },
  { title: "In Review", status: "in-review" },
  { title: "Completed", status: "completed" },
] as const;

interface DashboardProps {
  showCompleted: boolean;
  selectedProjects: Set<string>;
}

export function Dashboard({ showCompleted, selectedProjects }: DashboardProps) {
  const { plans, loading, refresh } = usePlans();
  const [startingAll, setStartingAll] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const handleStartAll = async () => {
    setStartingAll(true);
    try {
      await startAllWork();
      refresh();
    } catch (e) {
      console.error("Failed to start all work:", e);
    } finally {
      setStartingAll(false);
    }
  };

  const filteredPlans = useMemo(() => {
    if (selectedProjects.size === 0) return plans;
    return plans.filter((p) =>
      selectedProjects.has(p.project_name ?? p.project_path)
    );
  }, [plans, selectedProjects]);

  if (loading) {
    return <p className="text-muted-foreground">Loading plans...</p>;
  }

  if (plans.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No plans tracked yet.</p>
        <p className="text-sm mt-1 mb-4">
          Use <code className="font-mono bg-muted px-1 rounded">tracker add</code> to register a
          plan, or create a new task below.
        </p>
        <Button onClick={() => setCreateModalOpen(true)}>
          <PlusIcon className="h-4 w-4 mr-2" />
          New Task
        </Button>
        <CreateTaskModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onCreated={refresh}
        />
      </div>
    );
  }

  const grouped = new Map<string, Plan[]>();
  for (const col of COLUMNS) {
    grouped.set(col.status, []);
  }
  for (const plan of filteredPlans) {
    const bucket = grouped.get(plan.status);
    if (bucket) bucket.push(plan);
  }

  const columns = showCompleted ? COLUMNS : COLUMNS.filter((c) => c.status !== "completed");
  const openCount = (grouped.get("open") ?? []).length;

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
          <PlusIcon className="h-4 w-4 mr-1" />
          New Task
        </Button>
        {openCount > 0 && (
          <Button size="sm" variant="outline" onClick={handleStartAll} disabled={startingAll}>
            {startingAll ? "Starting..." : `Start All (${openCount})`}
          </Button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1 overflow-y-auto sm:overflow-y-hidden sm:overflow-x-auto">
        {columns.map((col) => (
          <KanbanColumn
            key={col.status}
            title={col.title}
            plans={grouped.get(col.status) ?? []}
            onRefresh={refresh}
          />
        ))}
      </div>
      <CreateTaskModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={refresh}
      />
    </div>
  );
}
