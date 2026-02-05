import { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { LogViewer } from "./LogViewer";
import { PlanViewer } from "./PlanViewer";
import { PlanEditor } from "./PlanEditor";
import { startPlanWork, generatePlan, type Plan } from "../api";

interface PlanCardProps {
  plan: Plan;
  onRefresh: () => void;
}

export function PlanCard({ plan, onRefresh }: PlanCardProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [generating, setGenerating] = useState(false);

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

  const handleGeneratePlan = async () => {
    setGenerating(true);
    try {
      const result = await generatePlan(plan.id);
      if (result.ok) {
        onRefresh();
      } else {
        console.error("Failed to generate plan:", result.message);
      }
    } catch (e) {
      console.error("Failed to generate plan:", e);
    } finally {
      setGenerating(false);
    }
  };

  const canStart = plan.status === "open" && plan.plan_path;
  const canViewLogs = plan.status === "in-progress" || plan.status === "in-review";
  const hasPlan = !!plan.plan_path;
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
          <div className="flex flex-wrap gap-2 mt-1">
            {hasPlan && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setViewerOpen(true)}>
                  View Plan
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditorOpen(true)}>
                  Edit
                </Button>
              </>
            )}
            {!hasPlan && plan.status === "open" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleGeneratePlan} disabled={generating}>
                {generating ? "Generating..." : "Generate Plan"}
              </Button>
            )}
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
      <PlanViewer
        planId={plan.id}
        planTitle={title}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
      <PlanEditor
        planId={plan.id}
        planTitle={title}
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          onRefresh();
        }}
      />
    </>
  );
}
