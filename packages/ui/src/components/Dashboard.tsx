import { useMemo } from "react";
import { usePlans } from "../hooks/usePlans";
import { KanbanColumn } from "./KanbanColumn";
import type { Plan } from "../api";

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
        <p className="text-sm mt-1">
          Use <code className="font-mono bg-muted px-1 rounded">tracker add</code> to register a
          plan.
        </p>
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

  return (
    <div className="flex gap-4 h-full overflow-x-auto">
      {columns.map((col) => (
        <KanbanColumn
          key={col.status}
          title={col.title}
          plans={grouped.get(col.status) ?? []}
          onRefresh={refresh}
        />
      ))}
    </div>
  );
}
