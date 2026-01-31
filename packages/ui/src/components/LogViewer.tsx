import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useEventSource } from "../hooks/useEventSource";
import { planLogsURL } from "../api";
import { ArrowDownIcon } from "lucide-react";
import { Button } from "./ui/button";

interface LogEntry {
  kind: "text" | "tool" | "tool_result" | "result" | "system";
  content: string;
  detail?: string;
}

function parseLogLine(raw: string): LogEntry | null {
  try {
    const obj = JSON.parse(raw);

    if (obj.type === "system") {
      return null; // skip init messages
    }

    if (obj.type === "assistant" && obj.message?.content) {
      const entries: LogEntry[] = [];
      for (const c of obj.message.content) {
        if (c.type === "text" && c.text?.trim()) {
          entries.push({ kind: "text", content: c.text.trim() });
        }
        if (c.type === "tool_use") {
          const name = c.name ?? "unknown";
          const input = c.input ?? {};

          if (name === "Write") {
            entries.push({
              kind: "tool",
              content: `Write ${input.file_path ?? ""}`,
              detail: input.content,
            });
          } else if (name === "Edit") {
            const file = input.file_path ?? "";
            const old_s: string = input.old_string ?? "";
            const new_s: string = input.new_string ?? "";
            const diffLines: string[] = [];
            for (const l of old_s.split("\n")) diffLines.push(`- ${l}`);
            for (const l of new_s.split("\n")) diffLines.push(`+ ${l}`);
            entries.push({
              kind: "tool",
              content: `Edit ${file}`,
              detail: diffLines.join("\n"),
            });
          } else if (name === "Bash") {
            entries.push({
              kind: "tool",
              content: `Bash: ${input.command ?? ""}`,
            });
          } else if (name === "Read") {
            entries.push({
              kind: "tool",
              content: `Read ${input.file_path ?? ""}`,
            });
          } else if (
            name === "Glob" ||
            name === "Grep"
          ) {
            entries.push({
              kind: "tool",
              content: `${name}: ${input.pattern ?? ""}`,
            });
          } else if (name === "TodoWrite") {
            // skip todo noise
          } else if (name === "Task") {
            entries.push({
              kind: "tool",
              content: `Task: ${input.description ?? input.prompt?.slice(0, 80) ?? name}`,
            });
          } else {
            entries.push({ kind: "tool", content: `${name}` });
          }
        }
      }
      // Return only the first meaningful entry per message;
      // multi-content messages are sent as separate SSE events anyway
      return entries[0] ?? null;
    }

    if (obj.type === "user") {
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "tool_result") {
            const text =
              typeof c.content === "string"
                ? c.content
                : JSON.stringify(c.content ?? "");
            // Only show short or interesting results
            if (
              text.includes("Error") ||
              text.includes("error") ||
              text.includes("created successfully") ||
              text.includes("updated successfully")
            ) {
              return {
                kind: "tool_result",
                content: text.length > 300 ? text.slice(0, 300) + "..." : text,
              };
            }
            return null; // skip verbose tool results
          }
        }
      }
      return null;
    }

    if (obj.type === "result") {
      return {
        kind: "result",
        content: obj.result ?? (obj.is_error ? "Session ended with error" : "Session complete"),
      };
    }

    return null;
  } catch {
    return null;
  }
}

interface LogViewerProps {
  planId: number;
  planTitle: string;
  open: boolean;
  onClose: () => void;
}

export function LogViewer({
  planId,
  planTitle,
  open,
  onClose,
}: LogViewerProps) {
  const url = open ? planLogsURL(planId) : null;
  const { lines, connected } = useEventSource(url);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkIsAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 150);
  }, []);

  const entries = lines
    .map(parseLogLine)
    .filter((e): e is LogEntry => e !== null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries.length, isAtBottom]);

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="!max-w-[90vw] w-[1100px] h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Logs: {planTitle}
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                connected ? "bg-green-500" : "bg-muted-foreground"
              }`}
            />
          </DialogTitle>
        </DialogHeader>
        <div className="relative flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={checkIsAtBottom}
            className="h-full overflow-y-auto bg-zinc-950 px-5 py-4 font-mono text-sm"
          >
            {entries.length === 0 && (
              <span className="text-zinc-500">Waiting for log output...</span>
            )}
            {entries.map((entry, i) => (
              <LogEntryView key={i} entry={entry} />
            ))}
          </div>
          <div
            className={`absolute bottom-4 left-1/2 -translate-x-1/2 transition-all duration-200 ${
              isAtBottom
                ? "opacity-0 translate-y-2 pointer-events-none"
                : "opacity-100 translate-y-0"
            }`}
          >
            <Button
              size="sm"
              variant="secondary"
              className="shadow-lg gap-1.5"
              onClick={scrollToBottom}
            >
              <ArrowDownIcon className="size-3.5" />
              Scroll to bottom
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LogEntryView({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case "text":
      return (
        <div className="text-zinc-200 my-3 leading-relaxed whitespace-pre-wrap">
          {entry.content}
        </div>
      );
    case "tool":
      return (
        <div className="my-2">
          <div className="text-blue-400 text-xs">
            {entry.content}
          </div>
          {entry.detail && <DiffBlock text={entry.detail} />}
        </div>
      );
    case "tool_result":
      return (
        <div className="text-zinc-500 text-xs my-1 whitespace-pre-wrap">
          {entry.content}
        </div>
      );
    case "result":
      return (
        <div className="my-4 border-t border-zinc-800 pt-4 text-green-400 whitespace-pre-wrap">
          {entry.content}
        </div>
      );
    default:
      return null;
  }
}

function DiffBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="mt-1 text-xs leading-relaxed overflow-x-auto rounded bg-zinc-900 px-3 py-2 border border-zinc-800">
      {lines.map((line, i) => {
        let cls = "text-zinc-400";
        if (line.startsWith("+")) cls = "text-green-400";
        else if (line.startsWith("-")) cls = "text-red-400";
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
