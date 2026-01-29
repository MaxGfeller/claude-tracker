import { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { StatusBadge } from "./StatusBadge";
import { LogViewer } from "./LogViewer";
import { startPlanWork, type Plan } from "../api";

interface PlanCardProps {
  plan: Plan;
  onRefresh: () => void;
}

export function PlanCard({ plan, onRefresh }: PlanCardProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const handleStartWork = async () => {
    setStarting(true);
    try {
      await startPlanWork(plan.id);
      onRefresh();
      setLogOpen(true);
    } catch (e) {
      console.error("Failed to start work:", e);
    } finally {
      setStarting(false);
    }
  };

  const canStart = plan.status === "open";
  const canViewLogs = plan.status === "in-progress" || plan.status === "in-review";
  const title = plan.plan_title ?? "(untitled)";

  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-3 px-4">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground text-sm font-mono">#{plan.id}</span>
              <span className="font-medium truncate">{title}</span>
              <StatusBadge status={plan.status} />
            </div>
            {plan.branch && (
              <span className="text-xs text-muted-foreground font-mono truncate">
                {plan.branch}
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {canStart && (
              <Button size="sm" onClick={handleStartWork} disabled={starting}>
                {starting ? "Starting..." : "Start Work"}
              </Button>
            )}
            {canViewLogs && (
              <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
                View Logs
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <LogViewer
        planId={plan.id}
        planTitle={title}
        open={logOpen}
        onClose={() => setLogOpen(false)}
      />
    </>
  );
}
