import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { fetchPlanContent } from "../api";

interface PlanViewerProps {
  planId: number;
  planTitle: string;
  open: boolean;
  onClose: () => void;
}

export function PlanViewer({ planId, planTitle, open, onClose }: PlanViewerProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);

    fetchPlanContent(planId)
      .then(setContent)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [planId, open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="!max-w-[calc(100%-1rem)] sm:!max-w-[90vw] w-full sm:w-[900px] h-[calc(100%-2rem)] sm:h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 sm:px-6 sm:py-4 border-b shrink-0">
          <DialogTitle className="truncate">Plan: {planTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading && <p className="text-muted-foreground">Loading plan...</p>}
          {error && <p className="text-red-500">{error}</p>}
          {!loading && !error && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
