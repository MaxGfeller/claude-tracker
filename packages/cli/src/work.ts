import { type Plan, updateStatus, updateBranch } from "./db";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";

const LOGS_DIR = join(homedir(), ".local", "share", "task-tracker", "logs");

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function buildPrompt(planContent: string): string {
  return `You are implementing a plan. Here is the full plan content:

<plan>
${planContent}
</plan>

Instructions:
1. Implement the entire plan above, making all necessary code changes.
2. Look for test/lint/typecheck scripts in package.json (or Makefile, etc.) and run them to verify your changes.
3. If needed, add temporary test scripts to verify new functionality works correctly.
4. When all changes are complete and verified, commit all changes with an appropriate commit message.
5. Do not push to a remote — just commit locally.`;
}

export async function startWork(plan: Plan): Promise<void> {
  if (plan.status !== "open") {
    console.log(
      `${YELLOW}⚠${RESET} Plan ${BOLD}#${plan.id}${RESET} is "${plan.status}", skipping (only "open" plans can be worked on)`
    );
    return;
  }

  const slug = slugify(plan.plan_title ?? "untitled");
  const branch = `plan/${plan.id}-${slug}`;

  console.log(
    `${BOLD}▶${RESET} Starting work on plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Branch: ${branch}${RESET}`);
  console.log(`  ${DIM}Project: ${plan.project_path}${RESET}`);

  // Return to main branch before creating feature branch
  try {
    const mainResult = Bun.spawnSync(["git", "checkout", "main"], {
      cwd: plan.project_path,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (mainResult.exitCode !== 0) {
      const stderr = mainResult.stderr.toString().trim();
      console.error(`${RED}✗${RESET} Failed to checkout main: ${stderr}`);
      return;
    }

    const branchResult = Bun.spawnSync(["git", "checkout", "-b", branch], {
      cwd: plan.project_path,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (branchResult.exitCode !== 0) {
      const stderr = branchResult.stderr.toString().trim();
      console.error(`${RED}✗${RESET} Failed to create branch: ${stderr}`);
      return;
    }
  } catch (e: any) {
    console.error(`${RED}✗${RESET} Git error: ${e.message}`);
    return;
  }

  // Update DB
  updateStatus(plan.id, "in-progress");
  updateBranch(plan.id, branch);

  // Read plan content
  let planContent: string;
  try {
    planContent = readFileSync(plan.plan_path, "utf-8");
  } catch {
    console.error(`${RED}✗${RESET} Could not read plan file: ${plan.plan_path}`);
    return;
  }

  // Ensure logs directory exists
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(LOGS_DIR, `${plan.id}-${timestamp}.jsonl`);

  console.log(`  ${DIM}Log: ${logPath}${RESET}\n`);

  const prompt = buildPrompt(planContent);

  // Invoke claude
  return new Promise<void>((resolve) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"],
      {
        cwd: plan.project_path,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      }
    );

    const logFile = Bun.file(logPath);
    const logWriter = logFile.writer();

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(text);
      logWriter.write(text);
    });

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      process.stderr.write(text);
      logWriter.write(text);
    });

    child.on("close", (code) => {
      logWriter.flush();
      logWriter.end();

      if (code === 0) {
        updateStatus(plan.id, "in-review");
        console.log(
          `\n${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} completed — status set to ${GREEN}in-review${RESET}`
        );
      } else {
        console.error(
          `\n${RED}✗${RESET} Plan ${BOLD}#${plan.id}${RESET} exited with code ${code} — status remains ${YELLOW}in-progress${RESET}`
        );
      }
      resolve();
    });
  });
}

async function runProjectPlansSequentially(plans: Plan[]): Promise<void> {
  for (const plan of plans) {
    await startWork(plan);
  }
}

export async function startWorkMultiple(plans: Plan[]): Promise<void> {
  // Group plans by project — sequential within a project, parallel across projects
  const byProject = new Map<string, Plan[]>();
  for (const plan of plans) {
    const key = plan.project_path;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(plan);
  }

  await Promise.all(
    Array.from(byProject.values()).map((projectPlans) =>
      runProjectPlansSequentially(projectPlans)
    )
  );

  console.log(`\n${BOLD}Summary:${RESET} ${plans.length} plan(s) processed`);
}
