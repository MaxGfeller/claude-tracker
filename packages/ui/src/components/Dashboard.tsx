import { usePlans } from "../hooks/usePlans";
import { ProjectGroup } from "./ProjectGroup";
import type { Plan } from "../api";

export function Dashboard() {
  const { plans, loading, refresh } = usePlans();

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

  // Group by project
  const grouped = new Map<string, { name: string; path: string; plans: Plan[] }>();
  for (const plan of plans) {
    const key = plan.project_path;
    if (!grouped.has(key)) {
      grouped.set(key, {
        name: plan.project_name ?? plan.project_path.split("/").pop() ?? key,
        path: plan.project_path,
        plans: [],
      });
    }
    grouped.get(key)!.plans.push(plan);
  }

  return (
    <div className="space-y-8">
      {Array.from(grouped.values()).map((group) => (
        <ProjectGroup
          key={group.path}
          name={group.name}
          path={group.path}
          plans={group.plans}
          onRefresh={refresh}
        />
      ))}
    </div>
  );
}
