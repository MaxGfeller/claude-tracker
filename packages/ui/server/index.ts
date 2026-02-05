import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { homedir } from "os";
import { handleSSELogs } from "./sse";
import { handlePlanChat } from "./chat";
import { trackChild, removeChild, getActiveChildCount } from "./children";

// Track plans currently being generated
const generatingPlans = new Map<number, { startedAt: Date }>();

function isGeneratingPlan(id: number): boolean {
  return generatingPlans.has(id);
}

function startGenerating(id: number): void {
  generatingPlans.set(id, { startedAt: new Date() });
}

function stopGenerating(id: number): void {
  generatingPlans.delete(id);
}

// Import DB functions from the CLI package via workspace
import { listPlans, getPlan, createTask, updatePlanPath, deletePlan } from "@tracker/cli/src/db";
import { loadConfig } from "@tracker/cli/src/config";
import { initOTelCollector, shutdownOTelCollector } from "@tracker/cli/src/otel-setup";
import { UsageTracker } from "@tracker/cli/src/usage-tracker";
import { buildUsageLimits } from "@tracker/cli/src/usage-check";

const PORT = parseInt(process.env.PORT ?? "3847", 10);
const UI_DIR = resolve(import.meta.dir, "..");
const DIST_DIR = join(UI_DIR, "dist");
const CLI_PATH = resolve(UI_DIR, "..", "cli", "src", "cli.ts");

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function matchRoute(pathname: string, pattern: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // API routes
  if (pathname === "/api/plans" && method === "GET") {
    const plans = listPlans();
    return jsonResponse(plans);
  }

  // GET /api/usage - Get current usage and quota information
  if (pathname === "/api/usage" && method === "GET") {
    const config = loadConfig();

    if (!config.usageLimits?.enabled) {
      return jsonResponse({
        enabled: false,
        message: "Usage monitoring is disabled",
      });
    }

    try {
      await initOTelCollector();
      const tracker = new UsageTracker();
      const limits = buildUsageLimits(config.usageLimits);
      const usage = await tracker.getCurrentUsage(limits);
      await shutdownOTelCollector();

      const usagePercent = Math.floor((usage.inputTokensPerMinute / limits.maxInputTokensPerMinute) * 100);

      return jsonResponse({
        enabled: true,
        usage: {
          inputTokensPerMinute: Math.floor(usage.inputTokensPerMinute),
          requestsPerMinute: Math.floor(usage.requestsPerMinute),
          totalCostUSD: parseFloat(usage.totalCostUSD.toFixed(2)),
          availableInputTokens: Math.floor(usage.availableInputTokens),
          availableRequests: Math.floor(usage.availableRequests),
          usagePercent,
        },
        limits: {
          maxInputTokensPerMinute: limits.maxInputTokensPerMinute,
          maxRequestsPerMinute: limits.maxRequestsPerMinute,
          maxCostPerSession: limits.maxCostPerSession,
          minAvailableInputTokens: limits.minAvailableInputTokens,
          minAvailableRequests: limits.minAvailableRequests,
        },
        config: config.usageLimits,
      });
    } catch (error: any) {
      return jsonResponse({
        enabled: true,
        error: error.message || "Failed to fetch usage data",
      }, 500);
    }
  }

  let params = matchRoute(pathname, "/api/plans/:id");
  if (params && method === "GET") {
    const plan = getPlan(parseInt(params.id, 10));
    if (!plan) return jsonResponse({ error: "Not found" }, 404);
    return jsonResponse(plan);
  }

  // DELETE /api/plans/:id - Delete a task (only if not started)
  params = matchRoute(pathname, "/api/plans/:id");
  if (params && method === "DELETE") {
    const id = parseInt(params.id, 10);
    const plan = getPlan(id);
    if (!plan) return jsonResponse({ error: "Not found" }, 404);

    // Only allow deletion of open tasks (not started)
    if (plan.status !== "open") {
      return jsonResponse({ ok: false, message: `Cannot delete task with status "${plan.status}"` }, 400);
    }

    deletePlan(id);
    return jsonResponse({ ok: true, message: `Task #${id} deleted` });
  }

  if (pathname === "/api/plans/work-all" && method === "POST") {
    const plans = listPlans().filter((p: { status: string }) => p.status === "open");
    if (plans.length === 0) {
      return jsonResponse({ ok: false, started: [], message: "No open plans" }, 400);
    }

    const started: number[] = [];
    for (const plan of plans) {
      const child = spawn("bun", ["run", CLI_PATH, "work", String(plan.id)], {
        cwd: plan.project_path,
        stdio: "ignore",
        detached: true,
      });
      child.unref();

      if (child.pid) {
        trackChild(child.pid);
        child.on("exit", () => removeChild(child.pid!));
      }
      started.push(plan.id);
    }

    return jsonResponse({ ok: true, started, message: `Started work on ${started.length} plan(s)` });
  }

  params = matchRoute(pathname, "/api/plans/:id/work");
  if (params && method === "POST") {
    const id = parseInt(params.id, 10);
    const plan = getPlan(id);
    if (!plan) return jsonResponse({ error: "Not found" }, 404);
    if (plan.status !== "open") {
      return jsonResponse({ ok: false, message: `Plan is "${plan.status}", not "open"` }, 400);
    }

    // Spawn tracker work as background process
    const child = spawn("bun", ["run", CLI_PATH, "work", String(id)], {
      cwd: plan.project_path,
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    if (child.pid) {
      trackChild(child.pid);
      child.on("exit", () => removeChild(child.pid!));
    }

    return jsonResponse({ ok: true, message: `Started work on plan #${id}` });
  }

  params = matchRoute(pathname, "/api/plans/:id/logs");
  if (params && method === "GET") {
    const id = parseInt(params.id, 10);
    const plan = getPlan(id);
    if (!plan) return jsonResponse({ error: "Not found" }, 404);
    return handleSSELogs(id);
  }

  // POST /api/plans - Create a new task
  if (pathname === "/api/plans" && method === "POST") {
    try {
      const body = await req.json() as { title: string; projectPath: string; projectName?: string; description?: string };
      const { title, projectPath, projectName, description } = body;

      if (!title || !projectPath) {
        return jsonResponse({ error: "title and projectPath are required" }, 400);
      }

      if (!existsSync(projectPath)) {
        return jsonResponse({ error: `Project path not found: ${projectPath}` }, 400);
      }

      const plan = createTask(projectPath, title, projectName, description);
      return jsonResponse(plan);
    } catch (e: any) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // GET /api/plans/:id/plan-status - Check plan generation status
  params = matchRoute(pathname, "/api/plans/:id/plan-status");
  if (params && method === "GET") {
    const id = parseInt(params.id, 10);
    const plan = getPlan(id);
    if (!plan) return jsonResponse({ error: "Not found" }, 404);

    if (isGeneratingPlan(id)) {
      return jsonResponse({ status: "generating" });
    }

    if (plan.plan_path && existsSync(plan.plan_path)) {
      return jsonResponse({ status: "complete", planPath: plan.plan_path });
    }

    return jsonResponse({ status: "none" });
  }

  // POST /api/plans/:id/plan - Generate a plan via Claude (async)
  params = matchRoute(pathname, "/api/plans/:id/plan");
  if (params && method === "POST") {
    const id = parseInt(params.id, 10);
    const plan = getPlan(id);
    if (!plan) return jsonResponse({ error: "Not found" }, 404);

    if (!plan.plan_title) {
      return jsonResponse({ error: "Task has no title" }, 400);
    }

    if (isGeneratingPlan(id)) {
      return jsonResponse({ ok: false, message: "Plan generation already in progress" }, 409);
    }

    // Build the prompt including description if available
    let taskDetails = `Task: ${plan.plan_title}`;
    if (plan.description) {
      taskDetails += `\nDescription: ${plan.description}`;
    }
    taskDetails += `\nProject: ${plan.project_path}`;

    const prompt = `Create a detailed implementation plan for:
${taskDetails}

Include:
1. Overview
2. Step-by-step approach
3. Files to modify/create
4. Testing strategy
5. Potential challenges

Start with a # heading. Output ONLY the plan markdown, no other text.`;

    // Mark as generating
    startGenerating(id);

    // Spawn Claude async with -p flag (print mode)
    const claudeArgs = ["-p", prompt];
    const child = spawn("claude", claudeArgs, {
      cwd: plan.project_path,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      stopGenerating(id);

      if (code !== 0) {
        console.error(`Claude plan generation failed for plan #${id}: exit code ${code}`);
        if (stderr) console.error(`stderr: ${stderr}`);
        return;
      }

      // Save plan to file
      const plansDir = join(homedir(), ".claude", "plans");
      if (!existsSync(plansDir)) {
        mkdirSync(plansDir, { recursive: true });
      }

      const slug = plan.plan_title!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const planFileName = `${slug}-${timestamp}.md`;
      const planPath = join(plansDir, planFileName);

      writeFileSync(planPath, stdout);
      updatePlanPath(plan.id, planPath);
      console.log(`Plan generated for #${id}: ${planPath}`);
    });

    child.on("error", (err) => {
      stopGenerating(id);
      console.error(`Failed to spawn Claude for plan #${id}:`, err);
    });

    return jsonResponse({ ok: true, message: "Plan generation started", status: "generating" });
  }

  // GET /api/plans/:id/plan-content - Get the plan markdown content
  params = matchRoute(pathname, "/api/plans/:id/plan-content");
  if (params && method === "GET") {
    const id = parseInt(params.id, 10);
    const plan = getPlan(id);
    if (!plan) return jsonResponse({ error: "Not found" }, 404);

    if (!plan.plan_path || !existsSync(plan.plan_path)) {
      return jsonResponse({ error: "Plan file not found" }, 404);
    }

    const content = readFileSync(plan.plan_path, "utf-8");
    return new Response(content, {
      headers: { "Content-Type": "text/markdown" },
    });
  }

  // POST /api/plans/:id/chat - Send a chat message for plan editing
  params = matchRoute(pathname, "/api/plans/:id/chat");
  if (params && method === "POST") {
    const id = parseInt(params.id, 10);
    const plan = getPlan(id);
    if (!plan) return jsonResponse({ error: "Not found" }, 404);

    try {
      const body = await req.json() as { message: string };
      const { message } = body;

      if (!message) {
        return jsonResponse({ error: "message is required" }, 400);
      }

      return handlePlanChat(plan, message);
    } catch (e: any) {
      return jsonResponse({ error: e.message }, 400);
    }
  }

  // Static file serving (production)
  if (existsSync(DIST_DIR)) {
    const filePath = join(DIST_DIR, pathname === "/" ? "index.html" : pathname);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback
    const indexFile = Bun.file(join(DIST_DIR, "index.html"));
    if (await indexFile.exists()) {
      return new Response(indexFile);
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
}

console.log(`Task Tracker API server running on http://localhost:${PORT}`);

Bun.serve({
  port: PORT,
  fetch: handleRequest,
  idleTimeout: 120, // Allow up to 2 minutes for Claude operations
});

// Graceful shutdown handling
let prompting = false;

process.on("SIGINT", () => {
  if (prompting) {
    // Double Ctrl+C: force exit
    console.log("\nForce exiting.");
    process.exit(0);
  }

  const count = getActiveChildCount();
  if (count === 0) {
    process.exit(0);
  }

  prompting = true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(
    `\n${count} work process${count > 1 ? "es" : ""} still running. Exit anyway? Workers will continue in the background. (y/N) `,
    (answer) => {
      rl.close();
      prompting = false;
      if (answer.trim().toLowerCase() === "y") {
        process.exit(0);
      }
      console.log("Resuming server.");
    },
  );
});

process.on("SIGTERM", () => {
  const count = getActiveChildCount();
  if (count > 0) {
    console.log(`Exiting. ${count} work process${count > 1 ? "es" : ""} will continue in the background.`);
  }
  process.exit(0);
});
