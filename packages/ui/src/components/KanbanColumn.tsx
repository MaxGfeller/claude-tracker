import { PlanCard } from "./PlanCard";
import type { Plan } from "../api";

interface KanbanColumnProps {
  title: string;
  plans: Plan[];
  onRefresh: () => void;
}

export function KanbanColumn({ title, plans, onRefresh }: KanbanColumnProps) {
  return (
    <div className="flex flex-col w-full sm:min-w-[300px] sm:w-[300px] sm:shrink-0 bg-muted/40 rounded-lg">
      <div className="flex items-center gap-2 px-3 py-3 font-semibold text-sm">
        <span>{title}</span>
        <span className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
          {plans.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  );
}
