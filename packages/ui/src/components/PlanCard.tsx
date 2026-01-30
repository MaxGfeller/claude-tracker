import { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
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
  const projectName = plan.project_name ?? plan.project_path.split("/").pop() ?? plan.project_path;

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-2 py-3 px-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs font-mono">#{plan.id}</span>
            <span className="text-xs text-muted-foreground truncate">{projectName}</span>
          </div>
          <span className="font-medium text-sm leading-snug">{title}</span>
          {plan.branch && (
            <span className="text-xs text-muted-foreground font-mono truncate">
              {plan.branch}
            </span>
          )}
          <div className="flex gap-2 mt-1">
            {canStart && (
              <Button size="sm" className="h-7 text-xs" onClick={handleStartWork} disabled={starting}>
                {starting ? "Starting..." : "Start Work"}
              </Button>
            )}
            {canViewLogs && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLogOpen(true)}>
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
