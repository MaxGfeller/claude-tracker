import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { usePlans } from "../hooks/usePlans";
import { fetchUsage, type UsageData } from "../api";
import { useEffect, useState } from "react";

interface HeaderProps {
  showCompleted: boolean;
  onToggleCompleted: () => void;
  selectedProjects: Set<string>;
  onSelectedProjectsChange: (projects: Set<string>) => void;
}

export function Header({
  showCompleted,
  onToggleCompleted,
  selectedProjects,
  onSelectedProjectsChange,
}: HeaderProps) {
  const { plans } = usePlans();
  const [usage, setUsage] = useState<UsageData | null>(null);

  const projects = [...new Set(plans.map((p) => p.project_name ?? p.project_path))].sort();

  // Fetch usage data on mount and every 30 seconds
  useEffect(() => {
    const fetchUsageData = async () => {
      try {
        const data = await fetchUsage();
        setUsage(data);
      } catch (err) {
        console.error("Failed to fetch usage:", err);
      }
    };

    fetchUsageData();
    const interval = setInterval(fetchUsageData, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  function toggleProject(project: string) {
    const next = new Set(selectedProjects);
    if (next.has(project)) {
      next.delete(project);
    } else {
      next.add(project);
    }
    onSelectedProjectsChange(next);
  }

  return (
    <header className="border-b bg-card">
      <div className="px-3 py-3 sm:px-6 sm:py-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">Task Tracker</h1>
          {usage?.enabled && usage.usage && (
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Usage:</span>
                <span className={usage.usage.usagePercent >= 90 ? "text-red-500 font-semibold" : usage.usage.usagePercent >= 70 ? "text-yellow-500 font-semibold" : "text-green-600 font-semibold"}>
                  {usage.usage.usagePercent}%
                </span>
              </div>
              <div className="text-muted-foreground">
                {usage.usage.inputTokensPerMinute.toLocaleString()} / {usage.limits!.maxInputTokensPerMinute.toLocaleString()} tok/min
              </div>
              {usage.usage.totalCostUSD > 0 && (
                <div className="text-muted-foreground">
                  ${usage.usage.totalCostUSD.toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground select-none">
            Show completed
          </label>
          <Switch checked={showCompleted} onCheckedChange={onToggleCompleted} />
        </div>
      </div>
      {projects.length > 1 && (
        <div className="px-3 pb-2 sm:px-6 sm:pb-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Projects</span>
          {projects.map((project) => {
            const active =
              selectedProjects.size === 0 || selectedProjects.has(project);
            return (
              <Badge
                key={project}
                variant={active ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleProject(project)}
              >
                {project}
              </Badge>
            );
          })}
          {selectedProjects.size > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground ml-1"
              onClick={() => onSelectedProjectsChange(new Set())}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </header>
  );
}
