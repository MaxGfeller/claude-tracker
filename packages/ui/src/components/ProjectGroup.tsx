import { PlanCard } from "./PlanCard";
import type { Plan } from "../api";

interface ProjectGroupProps {
  name: string;
  path: string;
  plans: Plan[];
  onRefresh: () => void;
}

export function ProjectGroup({ name, path, plans, onRefresh }: ProjectGroupProps) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{name}</h2>
        <p className="text-sm text-muted-foreground font-mono">{path}</p>
      </div>
      <div className="space-y-2">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onRefresh={onRefresh} />
        ))}
      </div>
    </section>
  );
}
