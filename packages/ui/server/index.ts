import { existsSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { handleSSELogs } from "./sse";
import { trackChild, removeChild, getActiveChildCount } from "./children";

// Import DB functions from the CLI package via workspace
import { listPlans, getPlan } from "@tracker/cli/src/db";

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

  let params = matchRoute(pathname, "/api/plans/:id");
  if (params && method === "GET") {
    const plan = getPlan(parseInt(params.id, 10));
    if (!plan) return jsonResponse({ error: "Not found" }, 404);
    return jsonResponse(plan);
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
