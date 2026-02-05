import { type Plan, updateStatus, updateBranch, updateSessionId, updateWorktreePath } from "./db";
import { loadConfig } from "./config";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { spawn, execSync } from "child_process";
import { createWorktree, checkGitVersion, formatWorktreePath } from "./worktree";

const LOGS_DIR = join(homedir(), ".local", "share", "task-tracker", "logs");
const MAX_REVIEW_ROUNDS = loadConfig().maxReviewRounds!;

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

type Writer = ReturnType<ReturnType<typeof Bun.file>["writer"]>;

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

function buildReviewPrompt(planContent: string, diff: string): string {
  return `You are a code reviewer. You are reviewing changes made by another Claude Code agent.

<plan>
${planContent}
</plan>

<diff>
${diff}
</diff>

Review the changes against the plan. Check for:
1. Completeness — does the diff implement the full plan?
2. Correctness — any bugs, logic errors, or missed edge cases?
3. Code quality — clean code, no leftover debug statements, follows project conventions?

If everything looks good, approve. If there are issues, describe each clearly.

End your response with exactly one of:
<verdict>APPROVE</verdict>
<verdict>REQUEST_CHANGES</verdict>`;
}

function buildRevisionPrompt(feedback: string): string {
  return `A code reviewer has reviewed your changes and requested revisions:

<review_feedback>
${feedback}
</review_feedback>

Please address all the reviewer's feedback. When done, commit the changes.`;
}

function parseVerdict(output: string): { approved: boolean; feedback: string } {
  const regex = /<verdict>(APPROVE|REQUEST_CHANGES)<\/verdict>/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) {
    return { approved: false, feedback: output };
  }
  return {
    approved: lastMatch[1] === "APPROVE",
    feedback: output,
  };
}

function writeTempFile(content: string, prefix: string): string {
  const filePath = join(tmpdir(), `tracker-${prefix}-${randomUUID()}.md`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function spawnClaude(opts: {
  args: string[];
  cwd: string;
  logWriter: Writer;
  promptFile?: string;
  otelEnv?: Record<string, string>;
  silent?: boolean;
}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("claude", opts.args, {
      cwd: opts.cwd,
      stdio: [opts.promptFile ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env, ...opts.otelEnv },
    });

    if (opts.promptFile) {
      const content = readFileSync(opts.promptFile, "utf-8");
      child.stdin!.write(content);
      child.stdin!.end();
    }

    let output = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      if (!opts.silent) {
        process.stdout.write(text);
      }
      opts.logWriter.write(text);
      output += text;
    });

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      if (!opts.silent) {
        process.stderr.write(text);
      }
      opts.logWriter.write(text);
    });

    child.on("close", (code) => {
      if (opts.promptFile) {
        try { unlinkSync(opts.promptFile); } catch {}
      }
      resolve({ code: code ?? 1, output });
    });
  });
}

async function runReviewLoop(
  plan: Plan,
  planContent: string,
  sessionId: string,
  logWriter: Writer,
  otelEnv?: Record<string, string>,
  workingDir?: string
): Promise<void> {
  const cwd = workingDir ?? plan.project_path;

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    console.log(`  ${DIM}Review round ${round}/${MAX_REVIEW_ROUNDS}...${RESET}`);

    // Get diff against main
    let diff: string;
    try {
      diff = execSync("git diff main...HEAD", {
        cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      console.error(`${RED}✗${RESET} Failed to get git diff — skipping review`);
      return;
    }

    if (!diff.trim()) {
      console.log(`${YELLOW}⚠${RESET} No diff found against main — skipping review`);
      return;
    }

    // Spawn reviewer
    const reviewPrompt = buildReviewPrompt(planContent, diff);
    const reviewPromptFile = writeTempFile(reviewPrompt, "review");
    const reviewResult = await spawnClaude({
      args: [
        "-p",
        "-",
        "--dangerously-skip-permissions",
        "--verbose",
        "--output-format",
        "stream-json",
      ],
      cwd,
      logWriter,
      promptFile: reviewPromptFile,
      otelEnv,
      silent: true,
    });

    if (reviewResult.code !== 0) {
      console.error(`${RED}✗${RESET} Reviewer exited with code ${reviewResult.code} — skipping review`);
      return;
    }

    const verdict = parseVerdict(reviewResult.output);

    if (verdict.approved) {
      console.log(`  ${GREEN}✓${RESET} Review approved`);
      return;
    }

    console.log(`  ${YELLOW}↻${RESET} Changes requested, revising...`);

    // Resume worker with feedback
    const revisionPrompt = buildRevisionPrompt(verdict.feedback);
    const revisionPromptFile = writeTempFile(revisionPrompt, "revision");
    const workerResult = await spawnClaude({
      args: [
        "--resume",
        sessionId,
        "-p",
        "-",
        "--dangerously-skip-permissions",
        "--verbose",
        "--output-format",
        "stream-json",
      ],
      cwd,
      logWriter,
      promptFile: revisionPromptFile,
      otelEnv,
      silent: true,
    });

    if (workerResult.code !== 0) {
      console.error(
        `${RED}✗${RESET} Worker exited with code ${workerResult.code} during revision — stopping review loop`
      );
      return;
    }
  }

  console.log(
    `  ${YELLOW}⚠${RESET} Max review rounds (${MAX_REVIEW_ROUNDS}) reached`
  );
}

export async function startWork(plan: Plan, otelEnv?: Record<string, string>): Promise<void> {
  if (plan.status !== "open") {
    console.log(
      `${YELLOW}⚠${RESET} Plan ${BOLD}#${plan.id}${RESET} is "${plan.status}", skipping (only "open" plans can be worked on)`
    );
    return;
  }

  const config = loadConfig();
  const worktreeEnabled = config.worktree?.enabled ?? true;
  const slug = slugify(plan.plan_title ?? "untitled");
  const branch = `plan/${plan.id}-${slug}`;

  console.log(
    `${BOLD}▶${RESET} Starting work on plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Branch: ${branch}${RESET}`);
  console.log(`  ${DIM}Project: ${plan.project_path}${RESET}`);

  let workingDir = plan.project_path;
  let worktreePath: string | null = null;

  // Check if worktree mode is enabled and git supports it
  const useWorktree = worktreeEnabled && checkGitVersion().supported;

  if (useWorktree) {
    // Create worktree with the branch
    const wtResult = createWorktree(plan.project_path, branch, plan.id);
    if (wtResult.ok) {
      workingDir = wtResult.path;
      worktreePath = wtResult.path;
      console.log(`  ${DIM}Worktree: ${formatWorktreePath(wtResult.path)}${RESET}`);
    } else {
      console.log(`  ${YELLOW}⚠${RESET} Failed to create worktree: ${wtResult.error}`);
      console.log(`  ${DIM}Falling back to branch in main repo${RESET}`);
    }
  }

  // If not using worktree, create branch in main repo
  if (!worktreePath) {
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
  }

  // Update DB
  updateStatus(plan.id, "in-progress");
  updateBranch(plan.id, branch);
  if (worktreePath) {
    updateWorktreePath(plan.id, worktreePath);
  }
  const sessionId = randomUUID();
  updateSessionId(plan.id, sessionId);

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
  const promptFile = writeTempFile(prompt, "work");

  const logFile = Bun.file(logPath);
  const logWriter = logFile.writer();

  console.log(`  ${DIM}Working...${RESET}\n`);

  // Invoke worker claude
  const workerResult = await spawnClaude({
    args: [
      "-p",
      "-",
      "--session-id",
      sessionId,
      "--dangerously-skip-permissions",
      "--verbose",
      "--output-format",
      "stream-json",
    ],
    cwd: workingDir,
    logWriter,
    promptFile,
    otelEnv,
    silent: true,
  });

  if (workerResult.code === 0) {
    await runReviewLoop(plan, planContent, sessionId, logWriter, otelEnv, workingDir);

    updateStatus(plan.id, "in-review");
    console.log(
      `\n${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} — status set to ${GREEN}in-review${RESET}`
    );
  } else {
    console.error(
      `\n${RED}✗${RESET} Plan ${BOLD}#${plan.id}${RESET} exited with code ${workerResult.code} — status remains ${YELLOW}in-progress${RESET}`
    );
  }

  logWriter.flush();
  logWriter.end();
}

async function runProjectPlansSequentially(plans: Plan[], otelEnv?: Record<string, string>): Promise<void> {
  for (const plan of plans) {
    await startWork(plan, otelEnv);
  }
}

export async function startWorkMultiple(plans: Plan[], otelEnv?: Record<string, string>): Promise<void> {
  // Group plans by project — sequential within a project, parallel across projects
  const byProject = new Map<string, Plan[]>();
  for (const plan of plans) {
    const key = plan.project_path;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(plan);
  }

  await Promise.all(
    Array.from(byProject.values()).map((projectPlans) =>
      runProjectPlansSequentially(projectPlans, otelEnv)
    )
  );

  console.log(`\n${BOLD}Summary:${RESET} ${plans.length} plan(s) processed`);
}
