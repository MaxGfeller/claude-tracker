import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { useEventSource } from "../hooks/useEventSource";
import { planLogsURL } from "../api";

function parseLogLine(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    // stream-json format from Claude Code
    if (obj.type === "assistant" && obj.message?.content) {
      return obj.message.content
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("");
    }
    if (obj.type === "result" && obj.result) {
      return `[Result] ${obj.result}`;
    }
    if (obj.content) {
      return typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content);
    }
    return raw;
  } catch {
    return raw;
  }
}

interface LogViewerProps {
  planId: number;
  planTitle: string;
  open: boolean;
  onClose: () => void;
}

export function LogViewer({ planId, planTitle, open, onClose }: LogViewerProps) {
  const url = open ? planLogsURL(planId) : null;
  const { lines, connected } = useEventSource(url);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Logs: {planTitle}
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                connected ? "bg-green-500" : "bg-muted-foreground"
              }`}
            />
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 rounded-md border bg-zinc-950 p-4 font-mono text-sm text-green-400">
          <div className="whitespace-pre-wrap break-words">
            {lines.length === 0 && (
              <span className="text-muted-foreground">Waiting for log output...</span>
            )}
            {lines.map((line, i) => (
              <div key={i}>{parseLogLine(line)}</div>
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
