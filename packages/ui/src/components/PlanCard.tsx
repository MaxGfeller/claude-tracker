import { useState, useEffect } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { LogViewer } from "./LogViewer";
import { PlanViewer } from "./PlanViewer";
import { PlanEditor } from "./PlanEditor";
import { startPlanWork, generatePlan, waitForPlanGeneration, deleteTask, canStartWork, type Plan } from "../api";

function formatWorktreePath(path: string): string {
  // Abbreviate home directory with ~
  const homeDir = path.match(/^\/Users\/[^/]+/)?.[0] || path.match(/^\/home\/[^/]+/)?.[0];
  if (homeDir) {
    return "~" + path.slice(homeDir.length);
  }
  return path;
}

interface PlanCardProps {
  plan: Plan;
  allPlans: Plan[];
  onRefresh: () => void;
}

export function PlanCard({ plan, allPlans, onRefresh }: PlanCardProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedByTask, setBlockedByTask] = useState<{ id: number; title: string | null; status: string } | null>(null);

  // Get the dependency task if one exists
  const dependsOnTask = plan.depends_on_id ? allPlans.find((p) => p.id === plan.depends_on_id) : null;

  // Check if this task is blocked by its dependency
  useEffect(() => {
    if (plan.status === "open" && plan.depends_on_id) {
      canStartWork(plan.id).then((result) => {
        setIsBlocked(!result.allowed);
        setBlockedByTask(result.blockedBy ?? null);
      });
    } else {
      setIsBlocked(false);
      setBlockedByTask(null);
    }
  }, [plan.id, plan.status, plan.depends_on_id]);

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
      // Start generation (returns immediately)
      const startResult = await generatePlan(plan.id);
      if (!startResult.ok) {
        console.error("Failed to start plan generation:", startResult.message);
        return;
      }

      // Poll for completion
      const result = await waitForPlanGeneration(plan.id);
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
  const canStart = isOpen && plan.plan_path && !isBlocked;
  const canViewLogs = plan.status === "in-progress" || plan.status === "in-review";
  const hasPlan = !!plan.plan_path;
  const canEdit = hasPlan && isOpen;
  const title = plan.plan_title ?? "(untitled)";
  const projectName = plan.project_name ?? plan.project_path.split("/").pop() ?? plan.project_path;

  return (
    <>
      <Card className={isBlocked ? "opacity-60" : ""}>
        <CardContent className="flex flex-col gap-2 px-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs font-mono">#{plan.id}</span>
            <span className="text-xs text-muted-foreground truncate">{projectName}</span>
            {isBlocked && (
              <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 px-1.5 py-0.5 rounded">
                Blocked
              </span>
            )}
            <div className="grow"></div>
            {/* Secondary actions in dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                  <span className="sr-only">More options</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="12" cy="5" r="1" />
                    <circle cx="12" cy="19" r="1" />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hasPlan && (
                  <DropdownMenuItem onClick={() => setViewerOpen(true)}>
                    View Plan
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onClick={() => setEditorOpen(true)}>
                    Edit Plan
                  </DropdownMenuItem>
                )}
                {canViewLogs && (
                  <DropdownMenuItem onClick={() => setLogOpen(true)}>
                    View Logs
                  </DropdownMenuItem>
                )}
                {isOpen && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting..." : "Delete Task"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <span className="font-medium text-sm leading-snug">{title}</span>
          {dependsOnTask && (
            <div className="text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Depends on: #{dependsOnTask.id} {dependsOnTask.plan_title}
              </span>
            </div>
          )}
          {isBlocked && blockedByTask && (
            <div className="text-xs text-yellow-600 dark:text-yellow-400">
              Waiting for #{blockedByTask.id}
            </div>
          )}
          {plan.branch && (
            <span className="text-xs text-muted-foreground font-mono truncate">
              {plan.branch}
            </span>
          )}
          {plan.worktree_path && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono truncate">
              <span title={plan.worktree_path} className="truncate">
                {formatWorktreePath(plan.worktree_path)}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(plan.worktree_path!)}
                className="p-0.5 hover:text-foreground transition-colors"
                title="Copy path"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {/* Primary actions as buttons */}
            {!hasPlan && isOpen && (
              <Button size="sm" className="h-7 text-xs" onClick={handleGeneratePlan} disabled={generating}>
                {generating ? "Generating..." : "Generate Plan"}
              </Button>
            )}
            {canStart && (
              <Button size="sm" className="h-7 text-xs" onClick={handleStartWork} disabled={starting}>
                {starting ? "Starting..." : "Start Work"}
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
