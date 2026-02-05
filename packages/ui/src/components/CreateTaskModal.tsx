import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { createTask, type Plan } from "../api";
import { usePlans } from "../hooks/usePlans";

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (plan: Plan) => void;
}

export function CreateTaskModal({ open, onClose, onCreated }: CreateTaskModalProps) {
  const { plans } = usePlans();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get unique project paths from existing plans
  const existingProjects = [...new Set(plans.map((p) => p.project_path))].sort();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const finalPath = isCustomMode ? customPath : projectPath;
    if (!finalPath.trim()) {
      setError("Project path is required");
      return;
    }

    setCreating(true);
    try {
      const plan = await createTask(title.trim(), finalPath.trim(), undefined, description.trim() || undefined);
      setTitle("");
      setDescription("");
      setProjectPath("");
      setCustomPath("");
      setIsCustomMode(false);
      onCreated(plan);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setTitle("");
    setDescription("");
    setProjectPath("");
    setCustomPath("");
    setIsCustomMode(false);
    setError(null);
    onClose();
  };

  const handleProjectChange = (value: string) => {
    if (value === "__custom__") {
      setIsCustomMode(true);
      setProjectPath("");
    } else {
      setIsCustomMode(false);
      setProjectPath(value);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="title" className="text-sm font-medium">
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add user authentication"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional details about the task..."
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="project" className="text-sm font-medium">
                Project Path
              </label>
              {existingProjects.length > 0 && !isCustomMode ? (
                <select
                  id="project"
                  value={projectPath}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select a project...</option>
                  {existingProjects.map((path) => (
                    <option key={path} value={path}>
                      {path.split("/").slice(-2).join("/")}
                    </option>
                  ))}
                  <option value="__custom__">Enter custom path...</option>
                </select>
              ) : (
                <input
                  id="project"
                  type="text"
                  value={isCustomMode ? customPath : projectPath}
                  onChange={(e) => isCustomMode ? setCustomPath(e.target.value) : setProjectPath(e.target.value)}
                  placeholder="/path/to/project"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus={isCustomMode}
                />
              )}
              {isCustomMode && existingProjects.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setIsCustomMode(false)}
                >
                  Back to project list
                </button>
              )}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
