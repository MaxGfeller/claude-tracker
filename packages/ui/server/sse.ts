import { watch, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const LOGS_DIR = join(homedir(), ".local", "share", "task-tracker", "logs");

function findLogFile(planId: number): string | null {
  if (!existsSync(LOGS_DIR)) return null;

  const files = readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith(`${planId}-`) && f.endsWith(".jsonl"))
    .sort()
    .reverse();

  return files.length > 0 ? join(LOGS_DIR, files[0]) : null;
}

export function handleSSELogs(planId: number): Response {
  let closed = false;
  let watcher: ReturnType<typeof watch> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          closed = true;
        }
      }

      function streamFile(filePath: string) {
        // Read existing content
        let offset = 0;
        try {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim());
          for (const line of lines) {
            send("log", line);
          }
          offset = Buffer.byteLength(content, "utf-8");
        } catch {
          // file may not be readable yet
        }

        // Watch for new content
        try {
          watcher = watch(filePath, () => {
            try {
              const content = readFileSync(filePath, "utf-8");
              const bytes = Buffer.byteLength(content, "utf-8");
              if (bytes > offset) {
                const newContent = content.slice(
                  Buffer.from(content).slice(0, offset).toString().length
                );
                const newLines = newContent.split("\n").filter((l) => l.trim());
                for (const line of newLines) {
                  send("log", line);
                }
                offset = bytes;
              }
            } catch {
              // ignore read errors during watch
            }
          });
        } catch {
          // watch may fail
        }
      }

      // Try to find existing log file
      const logFile = findLogFile(planId);
      if (logFile) {
        streamFile(logFile);
      } else {
        // Poll until the log file appears
        let attempts = 0;
        pollTimer = setInterval(() => {
          attempts++;
          const file = findLogFile(planId);
          if (file) {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
            streamFile(file);
          } else if (attempts > 120) {
            // Stop polling after ~60s
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
            send("done", "timeout");
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        }, 500);
      }
    },
    cancel() {
      closed = true;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
