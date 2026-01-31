#!/usr/bin/env bun

import { addPlan, listPlans, updateStatus, getPlan, type Plan } from "./db";
import { parsePlanTitle } from "./plans";
import { startWork, startWorkMultiple } from "./work";
import { selectPlans } from "./select";
import { loadConfig } from "./config";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { spawnSync } from "child_process";
import { confirm } from "@inquirer/prompts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

function statusColor(status: string): string {
  switch (status) {
    case "open":
      return YELLOW;
    case "in-progress":
      return BLUE;
    case "completed":
      return GREEN;
    case "in-review":
      return CYAN;
    default:
      return RESET;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "open":
      return "○";
    case "in-progress":
      return "◐";
    case "completed":
      return "●";
    case "in-review":
      return "◎";
    default:
      return "?";
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function printUsage() {
  console.log(`${BOLD}tracker${RESET} — Track Claude Code plans across projects

${BOLD}Usage:${RESET}
  tracker add <plan-path> <project-dir>   Register a plan
  tracker list                            List all plans grouped by project
  tracker status <id> <status>            Update plan status (open|in-progress|completed|in-review)
  tracker work [id...]                    Start Claude Code on plans (interactive if no IDs)
  tracker checkout <id>                   Checkout plan branch and resume Claude Code conversation
  tracker complete [id]                   Merge plan branch into main and mark completed
  tracker complete [id] --db-only         Mark completed without git operations
  tracker reset <id>                      Reset plan to open, optionally deleting its branch
  tracker ui [port]                       Launch web dashboard (default port: 3847)

${BOLD}Examples:${RESET}
  tracker add ~/.claude/plans/my-plan.md /path/to/project
  tracker list
  tracker status 1 in-progress
  tracker work
  tracker work 1 2
  tracker checkout 3
  tracker complete 3
  tracker reset 3
  tracker ui
  tracker ui 8080`);
}

function cmdAdd(args: string[]) {
  const [planPath, projectDir] = args;
  if (!planPath || !projectDir) {
    console.error(`${RED}Error: add requires <plan-path> and <project-dir>${RESET}`);
    process.exit(1);
  }

  const resolvedPlan = resolve(planPath);
  const resolvedProject = resolve(projectDir);

  if (!existsSync(resolvedPlan)) {
    console.error(`${RED}Error: Plan file not found: ${resolvedPlan}${RESET}`);
    process.exit(1);
  }

  if (!existsSync(resolvedProject)) {
    console.error(`${RED}Error: Project directory not found: ${resolvedProject}${RESET}`);
    process.exit(1);
  }

  const title = parsePlanTitle(resolvedPlan);
  const plan = addPlan(resolvedPlan, resolvedProject, title ?? undefined);

  console.log(`${GREEN}✓${RESET} Registered plan ${BOLD}#${plan.id}${RESET}`);
  console.log(`  Title:   ${plan.plan_title ?? DIM + "(no title)" + RESET}`);
  console.log(`  Project: ${plan.project_name}`);
  console.log(`  Path:    ${plan.plan_path}`);
}

function cmdList() {
  const plans = listPlans();
  if (plans.length === 0) {
    console.log(`${DIM}No plans tracked yet. Use "tracker add" to register a plan.${RESET}`);
    return;
  }

  const grouped = new Map<string, Plan[]>();
  for (const plan of plans) {
    const key = plan.project_name ?? plan.project_path;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(plan);
  }

  for (const [project, projectPlans] of grouped) {
    console.log(`\n${BOLD}${project}${RESET} ${DIM}(${projectPlans[0].project_path})${RESET}`);
    for (const p of projectPlans) {
      const color = statusColor(p.status);
      const icon = statusIcon(p.status);
      const title = p.plan_title ?? "(untitled)";
      const date = formatDate(p.created_at);
      const branchInfo = p.status === "in-review" && p.branch ? ` ${CYAN}${p.branch}${RESET}` : "";
      console.log(
        `  ${color}${icon}${RESET} ${BOLD}#${p.id}${RESET} ${title} ${DIM}[${p.status}] ${date}${RESET}${branchInfo}`
      );
    }
  }
  console.log();
}

function cmdStatus(args: string[]) {
  const [idStr, status] = args;
  if (!idStr || !status) {
    console.error(`${RED}Error: status requires <id> and <status>${RESET}`);
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error(`${RED}Error: Invalid id "${idStr}"${RESET}`);
    process.exit(1);
  }

  try {
    const plan = updateStatus(id, status);
    if (!plan) {
      console.error(`${RED}Error: Plan #${id} not found${RESET}`);
      process.exit(1);
    }
    const color = statusColor(plan.status);
    console.log(
      `${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} → ${color}${plan.status}${RESET}`
    );
  } catch (e: any) {
    console.error(`${RED}Error: ${e.message}${RESET}`);
    process.exit(1);
  }
}

async function cmdWork(args: string[]) {
  if (args.length > 0) {
    // IDs provided directly
    const plans: Plan[] = [];
    for (const idStr of args) {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) {
        console.error(`${RED}Error: Invalid id "${idStr}"${RESET}`);
        process.exit(1);
      }
      const plan = getPlan(id);
      if (!plan) {
        console.error(`${RED}Error: Plan #${id} not found${RESET}`);
        process.exit(1);
      }
      plans.push(plan);
    }
    if (plans.length === 1) {
      await startWork(plans[0]);
    } else {
      await startWorkMultiple(plans);
    }
  } else {
    // Interactive selection
    const allPlans = listPlans();
    const openPlans = allPlans.filter((p) => p.status === "open");
    if (openPlans.length === 0) {
      console.log(`${DIM}No open plans available. Use "tracker add" to register a plan.${RESET}`);
      return;
    }
    const selected = await selectPlans(allPlans);
    if (selected.length === 0) {
      console.log(`${DIM}No plans selected.${RESET}`);
      return;
    }
    if (selected.length === 1) {
      await startWork(selected[0]);
    } else {
      await startWorkMultiple(selected);
    }
  }
}

function cmdCheckout(args: string[]) {
  const idStr = args[0];
  if (!idStr) {
    console.error(`${RED}Error: checkout requires a plan <id>${RESET}`);
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error(`${RED}Error: Invalid id "${idStr}"${RESET}`);
    process.exit(1);
  }

  const plan = getPlan(id);
  if (!plan) {
    console.error(`${RED}Error: Plan #${id} not found${RESET}`);
    process.exit(1);
  }

  if (!plan.branch) {
    console.error(`${RED}Error: Plan #${id} has no branch — it may not have been worked on yet${RESET}`);
    process.exit(1);
  }

  if (!plan.session_id) {
    console.error(`${RED}Error: Plan #${id} has no session ID — it was started before session tracking was added${RESET}`);
    process.exit(1);
  }

  console.log(
    `${BOLD}▶${RESET} Checking out plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Branch:  ${plan.branch}${RESET}`);
  console.log(`  ${DIM}Session: ${plan.session_id}${RESET}`);
  console.log(`  ${DIM}Project: ${plan.project_path}${RESET}`);

  // Checkout the branch
  const result = Bun.spawnSync(["git", "checkout", plan.branch], {
    cwd: plan.project_path,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    console.error(`${RED}✗${RESET} Failed to checkout branch: ${stderr}`);
    process.exit(1);
  }

  console.log(`${GREEN}✓${RESET} On branch ${CYAN}${plan.branch}${RESET}`);
  console.log(`\n${DIM}Resuming Claude Code conversation...${RESET}\n`);

  // Resume Claude Code conversation by session ID
  const args = ["--resume", plan.session_id];
  const config = loadConfig();
  if (config.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  const claude = spawnSync("claude", args, {
    cwd: plan.project_path,
    stdio: "inherit",
  });

  process.exit(claude.exitCode ?? 0);
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function planIdFromBranch(): number | null {
  const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const branch = result.stdout.toString().trim();
  const match = branch.match(/^plan\/(\d+)-/);
  return match ? parseInt(match[1], 10) : null;
}

async function cmdComplete(args: string[]) {
  const dbOnly = args.includes("--db-only");
  const filteredArgs = args.filter((a) => a !== "--db-only");

  let idStr = filteredArgs[0];

  // If no ID given, try to derive from the current branch
  if (!idStr) {
    const branchId = planIdFromBranch();
    if (branchId === null) {
      console.error(`${RED}Error: No plan ID provided and current branch is not a plan branch (plan/<id>-...)${RESET}`);
      process.exit(1);
    }
    idStr = String(branchId);
    console.log(`${DIM}Detected plan #${idStr} from current branch${RESET}`);
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error(`${RED}Error: Invalid id "${idStr}"${RESET}`);
    process.exit(1);
  }

  const plan = getPlan(id);
  if (!plan) {
    console.error(`${RED}Error: Plan #${id} not found${RESET}`);
    process.exit(1);
  }

  if (plan.status === "completed") {
    console.log(`${DIM}Plan #${id} is already completed.${RESET}`);
    return;
  }

  if (dbOnly) {
    updateStatus(plan.id, "completed");
    console.log(`${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} → ${GREEN}completed${RESET} (db only, no git operations)`);
    return;
  }

  if (!plan.branch) {
    console.error(`${RED}Error: Plan #${id} has no branch. Use --db-only to mark as completed without merging.${RESET}`);
    process.exit(1);
  }

  const cwd = plan.project_path;
  const branch = plan.branch;

  console.log(
    `${BOLD}▶${RESET} Completing plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Branch:  ${branch}${RESET}`);
  console.log(`  ${DIM}Project: ${cwd}${RESET}\n`);

  // Check for uncommitted changes
  const status = git(["status", "--porcelain"], cwd);
  if (status.stdout) {
    console.log(`${YELLOW}⚠${RESET} Working directory has uncommitted changes:\n`);
    console.log(`${DIM}${status.stdout.trim()}${RESET}\n`);
    const proceed = await confirm({
      message: "Continue anyway? Uncommitted changes may interfere with the merge.",
      default: false,
    });
    if (!proceed) {
      console.log(`${DIM}Aborted.${RESET}`);
      return;
    }
  }

  // Fetch latest main
  git(["fetch", "origin", "main"], cwd); // best-effort, may fail if no remote

  // Checkout the feature branch
  let result = git(["checkout", branch], cwd);
  if (!result.ok) {
    console.error(`${RED}✗${RESET} Failed to checkout ${branch}: ${result.stderr}`);
    process.exit(1);
  }
  console.log(`  Checked out ${CYAN}${branch}${RESET}`);

  // Merge main into feature branch (resolve conflicts here)
  result = git(["merge", "main"], cwd);
  if (!result.ok) {
    console.error(`${RED}✗${RESET} Merge main into ${branch} failed — there may be conflicts:\n${result.stderr}`);
    console.error(`\n${DIM}Resolve conflicts on this branch, commit, then re-run this command.${RESET}`);
    process.exit(1);
  }
  console.log(`  Merged ${CYAN}main${RESET} into ${CYAN}${branch}${RESET}`);

  // Checkout main
  result = git(["checkout", "main"], cwd);
  if (!result.ok) {
    console.error(`${RED}✗${RESET} Failed to checkout main: ${result.stderr}`);
    process.exit(1);
  }

  // Merge feature branch into main (should be clean now)
  result = git(["merge", branch, "-m", `Merge branch '${branch}'`], cwd);
  if (!result.ok) {
    console.error(`${RED}✗${RESET} Merge into main failed: ${result.stderr}`);
    process.exit(1);
  }
  console.log(`  Merged ${CYAN}${branch}${RESET} into ${CYAN}main${RESET}`);

  // Update status in DB
  updateStatus(plan.id, "completed");
  console.log(`\n${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} → ${GREEN}completed${RESET}`);
}

async function cmdReset(args: string[]) {
  const idStr = args[0];
  if (!idStr) {
    console.error(`${RED}Error: reset requires a plan <id>${RESET}`);
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error(`${RED}Error: Invalid id "${idStr}"${RESET}`);
    process.exit(1);
  }

  const plan = getPlan(id);
  if (!plan) {
    console.error(`${RED}Error: Plan #${id} not found${RESET}`);
    process.exit(1);
  }

  if (plan.status === "open") {
    console.log(`${DIM}Plan #${id} is already open.${RESET}`);
    return;
  }

  console.log(
    `${BOLD}▶${RESET} Resetting plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Status:  ${plan.status}${RESET}`);
  if (plan.branch) {
    console.log(`  ${DIM}Branch:  ${plan.branch}${RESET}`);
  }
  console.log(`  ${DIM}Project: ${plan.project_path}${RESET}\n`);

  // If there's a branch, check if it exists and offer to delete it
  if (plan.branch) {
    const cwd = plan.project_path;
    const branchCheck = git(["rev-parse", "--verify", plan.branch], cwd);
    if (branchCheck.ok) {
      const logResult = git(["log", "--oneline", "main.." + plan.branch], cwd);
      const commitCount = logResult.stdout ? logResult.stdout.split("\n").length : 0;
      if (commitCount > 0) {
        console.log(`${YELLOW}⚠${RESET} Branch ${CYAN}${plan.branch}${RESET} has ${commitCount} commit(s) not on main:\n`);
        console.log(`${DIM}${logResult.stdout}${RESET}\n`);
      }

      const deleteBranch = await confirm({
        message: `Delete branch ${plan.branch}?`,
        default: false,
      });

      if (deleteBranch) {
        // Make sure we're not on the branch we're deleting
        git(["checkout", "main"], cwd);
        const deleteResult = git(["branch", "-D", plan.branch], cwd);
        if (deleteResult.ok) {
          console.log(`  Deleted branch ${CYAN}${plan.branch}${RESET}`);
        } else {
          console.error(`${RED}✗${RESET} Failed to delete branch: ${deleteResult.stderr}`);
        }
      }
    }
  }

  updateStatus(plan.id, "open");
  console.log(`\n${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} → ${YELLOW}open${RESET}`);
}

function cmdUi(args: string[]) {
  const port = args[0] ?? "3847";
  const cliDir = dirname(new URL(import.meta.url).pathname);
  const uiPkg = resolve(cliDir, "..", "..", "ui");
  const serverPath = resolve(uiPkg, "server", "index.ts");
  const distDir = resolve(uiPkg, "dist");

  if (!existsSync(serverPath)) {
    console.error(`${RED}Error: UI server not found at ${serverPath}${RESET}`);
    process.exit(1);
  }

  // Build frontend if dist/ doesn't exist
  if (!existsSync(distDir)) {
    console.log(`${DIM}Building frontend...${RESET}`);
    const build = spawnSync("bun", ["run", "build"], {
      cwd: uiPkg,
      stdio: "inherit",
    });
    if (build.exitCode !== 0) {
      console.error(`${RED}Error: Frontend build failed${RESET}`);
      process.exit(1);
    }
  }

  const url = `http://localhost:${port}`;
  console.log(`${BOLD}▶${RESET} Starting Task Tracker UI at ${CYAN}${url}${RESET}`);

  // Open browser (macOS)
  spawnSync("open", [url]);

  // Run the server (foreground — keeps the process alive)
  const server = spawnSync("bun", ["run", serverPath], {
    env: { ...process.env, PORT: port },
    stdio: "inherit",
  });
  process.exit(server.exitCode ?? 0);
}

// Main
const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "add":
    cmdAdd(args);
    break;
  case "list":
    cmdList();
    break;
  case "status":
    cmdStatus(args);
    break;
  case "work":
    await cmdWork(args);
    break;
  case "checkout":
    cmdCheckout(args);
    break;
  case "complete":
    await cmdComplete(args);
    break;
  case "reset":
    await cmdReset(args);
    break;
  case "ui":
    cmdUi(args);
    break;
  case undefined:
  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;
  default:
    console.error(`${RED}Unknown command: ${command}${RESET}`);
    printUsage();
    process.exit(1);
}
