import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { usePlans } from "../hooks/usePlans";

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

  const projects = [...new Set(plans.map((p) => p.project_name ?? p.project_path))].sort();

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
        <h1 className="text-lg sm:text-xl font-bold tracking-tight">Task Tracker</h1>
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
