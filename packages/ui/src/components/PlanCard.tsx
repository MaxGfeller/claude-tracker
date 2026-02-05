import { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { LogViewer } from "./LogViewer";
import { PlanViewer } from "./PlanViewer";
import { PlanEditor } from "./PlanEditor";
import { startPlanWork, generatePlan, deleteTask, type Plan } from "../api";

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
  const [deleting, setDeleting] = useState(false);

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

  const handleDelete = async () => {
    if (!confirm(`Delete task "${plan.plan_title}"?`)) return;
    setDeleting(true);
    try {
      const result = await deleteTask(plan.id);
      if (result.ok) {
        onRefresh();
      } else {
        console.error("Failed to delete task:", result.message);
      }
    } catch (e) {
      console.error("Failed to delete task:", e);
    } finally {
      setDeleting(false);
    }
  };

  const isOpen = plan.status === "open";
  const canStart = isOpen && plan.plan_path;
  const canViewLogs = plan.status === "in-progress" || plan.status === "in-review";
  const hasPlan = !!plan.plan_path;
  const canEdit = hasPlan && isOpen;
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
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setViewerOpen(true)}>
                View Plan
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditorOpen(true)}>
                Edit
              </Button>
            )}
            {!hasPlan && isOpen && (
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
            {isOpen && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-xs">
                    <span className="sr-only">More options</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Delete Task"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
