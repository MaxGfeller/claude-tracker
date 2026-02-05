import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { updatePlanningSessionId, updatePlanPath, type Plan } from "@tracker/cli/src/db";
import { join } from "path";
import { homedir } from "os";

export function handlePlanChat(plan: Plan, message: string): Response {
  // Create or reuse planning session ID
  let sessionId = plan.planning_session_id;
  if (!sessionId) {
    sessionId = `planning-${plan.id}-${Date.now()}`;
    updatePlanningSessionId(plan.id, sessionId);
  }

  // Get current plan content if it exists
  let currentPlan = "";
  if (plan.plan_path && existsSync(plan.plan_path)) {
    currentPlan = readFileSync(plan.plan_path, "utf-8");
  }

  // Build context prompt
  const contextPrompt = currentPlan
    ? `You are editing an implementation plan. Here is the current plan:

<current-plan>
${currentPlan}
</current-plan>

User request: ${message}

If you make changes to the plan, output the FULL updated plan wrapped in <plan> tags like:
<plan>
# Updated Plan Title
...full plan content...
</plan>

If the user is just asking questions, respond conversationally without the <plan> tags.`
    : `You are helping create an implementation plan for:
Task: ${plan.plan_title}
Project: ${plan.project_path}

User request: ${message}

When you create or update the plan, output the FULL plan wrapped in <plan> tags like:
<plan>
# Plan Title
...full plan content...
</plan>`;

  // Create SSE stream
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      controller = null;
    },
  });

  // Spawn Claude with streaming
  const claudeArgs = [
    "-p",
    contextPrompt,
    "--session-id",
    sessionId,
    "--output-format",
    "stream-json",
  ];

  const child = spawn("claude", claudeArgs, {
    cwd: plan.project_path,
    stdio: ["inherit", "pipe", "pipe"],
  });

  let fullOutput = "";
  let buffer = "";

  child.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString();

    // Process complete JSON lines
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);

        // Extract text content from assistant messages
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === "text" && content.text) {
              fullOutput += content.text;

              // Send SSE event
              if (controller) {
                const event = `data: ${JSON.stringify({ type: "text", content: content.text })}\n\n`;
                controller.enqueue(encoder.encode(event));
              }
            }
          }
        }

        // Handle result/completion
        if (parsed.type === "result") {
          // Check if we got a plan in the output
          const planMatch = fullOutput.match(/<plan>([\s\S]*?)<\/plan>/);
          if (planMatch) {
            const planContent = planMatch[1].trim();
            savePlan(plan, planContent);

            // Notify client that plan was updated
            if (controller) {
              const event = `data: ${JSON.stringify({ type: "plan_updated", path: plan.plan_path })}\n\n`;
              controller.enqueue(encoder.encode(event));
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    if (controller) {
      const event = `data: ${JSON.stringify({ type: "error", content: text })}\n\n`;
      controller.enqueue(encoder.encode(event));
    }
  });

  child.on("close", (code) => {
    if (controller) {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.type === "assistant" && parsed.message?.content) {
            for (const content of parsed.message.content) {
              if (content.type === "text" && content.text) {
                fullOutput += content.text;
              }
            }
          }
        } catch {
          // Ignore
        }
      }

      // Check for plan in full output one more time
      const planMatch = fullOutput.match(/<plan>([\s\S]*?)<\/plan>/);
      if (planMatch) {
        const planContent = planMatch[1].trim();
        savePlan(plan, planContent);

        const event = `data: ${JSON.stringify({ type: "plan_updated", path: plan.plan_path })}\n\n`;
        controller.enqueue(encoder.encode(event));
      }

      const doneEvent = `data: ${JSON.stringify({ type: "done", exitCode: code })}\n\n`;
      controller.enqueue(encoder.encode(doneEvent));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function savePlan(plan: Plan, content: string): void {
  let planPath = plan.plan_path;

  // Create new plan file if none exists
  if (!planPath) {
    const { mkdirSync } = require("fs");

    const plansDir = join(homedir(), ".claude", "plans");
    if (!existsSync(plansDir)) {
      mkdirSync(plansDir, { recursive: true });
    }

    const slug = (plan.plan_title ?? "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const planFileName = `${slug}-${timestamp}.md`;
    planPath = join(plansDir, planFileName);

    updatePlanPath(plan.id, planPath);
  }

  writeFileSync(planPath, content);
}
