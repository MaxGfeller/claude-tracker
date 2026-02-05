#!/usr/bin/env bun

import {
  addPlan,
  listPlans,
  updateStatus,
  getPlan,
  deletePlan,
  createTask,
  updatePlanPath,
  updateWorktreePath,
  setDependency,
  removeDependency,
  getDependency,
  getDependents,
  canStartWork,
  canComplete,
  getDependencyChain,
  type Plan,
} from "./db";
import { parsePlanTitle } from "./plans";
import { startWork, startWorkMultiple } from "./work";
import { selectPlans } from "./select";
import { loadConfig, saveConfig, CONFIG_KEYS, CONFIG_PATH, type TrackerConfig } from "./config";
import { initOTelCollector, shutdownOTelCollector, getClaudeOTelEnv } from "./otel-setup";
import { checkUsageBeforeWork } from "./usage-check";
import { UsageTracker } from "./usage-tracker";
import { buildUsageLimits } from "./usage-check";
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync, appendFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { confirm } from "@inquirer/prompts";
import {
  createWorktree,
  worktreeExists,
  getWorktreePath,
  formatWorktreePath,
  checkGitVersion,
  removeWorktree,
  getWorktreeBase,
  getProjectId,
} from "./worktree";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

// Shell function templates for auto-cd on checkout
const SHELL_FUNCTION_BASH = `# Task Tracker shell function - auto-cd on checkout
tracker() {
  local real_tracker
  real_tracker=$(command which tracker 2>/dev/null || echo "tracker")

  if [[ "$1" == "checkout" ]]; then
    local output
    output=$("$real_tracker" "$@")
    local exit_code=$?
    echo "$output"

    if [[ $exit_code -eq 0 ]]; then
      local worktree_path
      worktree_path=$(echo "$output" | grep 'WORKTREE_PATH:' | sed 's/WORKTREE_PATH://')
      if [[ -n "$worktree_path" && -d "$worktree_path" ]]; then
        cd "$worktree_path" || true
      fi
    fi
    return $exit_code
  else
    "$real_tracker" "$@"
  fi
}
`;

const SHELL_FUNCTION_ZSH = `# Task Tracker shell function - auto-cd on checkout
tracker() {
  local real_tracker
  real_tracker=$(command which tracker 2>/dev/null || echo "tracker")

  if [[ "$1" == "checkout" ]]; then
    local output
    output=$("$real_tracker" "$@")
    local exit_code=$?
    echo "$output"

    if [[ $exit_code -eq 0 ]]; then
      local worktree_path
      worktree_path=$(echo "$output" | grep 'WORKTREE_PATH:' | sed 's/WORKTREE_PATH://')
      if [[ -n "$worktree_path" && -d "$worktree_path" ]]; then
        cd "$worktree_path" || true
      fi
    fi
    return $exit_code
  else
    "$real_tracker" "$@"
  fi
}
`;

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

function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath);
  while (current !== "/") {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function printUsage() {
  console.log(`${BOLD}tracker${RESET} — Track Claude Code plans across projects

${BOLD}Usage:${RESET}
  tracker create [options] <title>           Create a new task (infers project from git root)
    --project, -p <path>                     Specify project path
    --description, -d <text>                 Add a description for the task
    --depends-on <id>                        Set a dependency on another task
  tracker add <plan-path> <project-dir>   Register a plan
  tracker list                            List all plans grouped by project
  tracker status <id> <status>            Update plan status (open|in-progress|completed|in-review)
  tracker plan <id>                       Generate a plan for a task using Claude
  tracker work [id...]                    Start Claude Code on plans (interactive if no IDs)
                                          Blocked tasks (with unmet dependencies) are skipped
  tracker usage                           Show current usage and quota status
  tracker checkout <id>                   Setup worktree/branch (doesn't launch Claude)
  tracker resume <id>                     Resume Claude Code in plan's directory
  tracker complete [id]                   Merge plan branch into main and mark completed
  tracker complete [id] --db-only         Mark completed without git operations
  tracker reset <id>                      Reset plan to open, optionally deleting its branch
  tracker cancel <id>                     Cancel a plan, deleting it and its branch
  tracker cleanup                         Remove orphaned worktrees (no matching task)
  tracker set-dependency <id> <dep-id>    Set task <id> to depend on <dep-id>
  tracker clear-dependency <id>           Remove dependency from task <id>
  tracker show-deps <id>                  Show dependency chain for task <id>
  tracker config                          Show all config values
  tracker config <key>                    Get a config value
  tracker config <key> <value>            Set a config value
  tracker install-shell-function          Install shell function for auto-cd on checkout
  tracker ui [port]                       Launch web dashboard (default port: 3847)

${BOLD}Config keys:${RESET}
  skipPermissions                        (boolean)  Skip Claude permission prompts (default: false)
  maxReviewRounds                        (number)   Max review iterations per plan (default: 5)
  usageLimits.enabled                    (boolean)  Enable usage limit checking (default: false)
  usageLimits.minAvailableInputTokens    (number)   Min tokens required to start (default: 10000)
  usageLimits.minAvailableRequests       (number)   Min requests required to start (default: 5)
  usageLimits.maxCostPerSession          (number)   Max cost in USD per session (default: 1.0)
  usageLimits.maxWaitMinutes             (number)   Max wait time for quota reset (default: 10)
  usageLimits.organizationTier           (number)   Claude tier 1-4 (default: auto-detect)
  worktree.enabled                       (boolean)  Use git worktrees for isolation (default: true)
  worktree.copyGitignored                (boolean)  Copy .env files to worktrees (default: true)
  worktree.autoCleanupOnComplete         (boolean)  Remove worktree on completion (default: false)

${BOLD}Examples:${RESET}
  tracker create "Add user authentication"
  tracker create -d "OAuth2 with Google and GitHub" "Add social login"
  tracker create --project /path/to/repo "Add auth"
  tracker plan 5
  tracker add ~/.claude/plans/my-plan.md /path/to/project
  tracker list
  tracker status 1 in-progress
  tracker work
  tracker work 1 2
  tracker usage

  # Manual workflow:
  tracker checkout 3          # Setup worktree/branch
  cd ~/.task-tracker/...      # Navigate to worktree
  tracker resume 3            # Resume Claude

  # Auto workflow (one-time setup):
  tracker install-shell-function --auto
  source ~/.zshrc
  tracker checkout 3          # Auto-navigates!

  tracker complete 3
  tracker reset 3
  tracker config usageLimits.enabled true
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

function cmdCreate(args: string[]) {
  let projectPath: string | null = null;
  let description: string | null = null;
  let dependsOn: number | null = null;
  let title: string | null = null;

  // Parse args: --project <path>, --description <text>, --depends-on <id>, or just <title>
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--project" || args[i] === "-p") {
      projectPath = args[i + 1];
      i += 2;
    } else if (args[i] === "--description" || args[i] === "-d") {
      description = args[i + 1];
      i += 2;
    } else if (args[i] === "--depends-on") {
      const depId = parseInt(args[i + 1], 10);
      if (isNaN(depId)) {
        console.error(`${RED}Error: --depends-on requires a valid task ID${RESET}`);
        process.exit(1);
      }
      dependsOn = depId;
      i += 2;
    } else {
      // Remaining args are the title
      title = args.slice(i).join(" ");
      break;
    }
  }

  if (!title) {
    console.error(`${RED}Error: create requires a <title>${RESET}`);
    process.exit(1);
  }

  // If no project path, infer from git root
  if (!projectPath) {
    projectPath = findGitRoot(process.cwd());
    if (!projectPath) {
      console.error(`${RED}Error: Not in a git repository. Use --project to specify the project path.${RESET}`);
      process.exit(1);
    }
  }

  const resolvedProject = resolve(projectPath);
  if (!existsSync(resolvedProject)) {
    console.error(`${RED}Error: Project directory not found: ${resolvedProject}${RESET}`);
    process.exit(1);
  }

  const plan = createTask(resolvedProject, title, undefined, description ?? undefined);

  // Set dependency if provided
  if (dependsOn !== null) {
    try {
      setDependency(plan.id, dependsOn);
    } catch (e: any) {
      // If dependency fails, delete the task and report error
      deletePlan(plan.id);
      console.error(`${RED}Error: ${e.message}${RESET}`);
      process.exit(1);
    }
  }

  console.log(`${GREEN}✓${RESET} Created task ${BOLD}#${plan.id}${RESET}`);
  console.log(`  Title:   ${plan.plan_title}`);
  if (plan.description) {
    console.log(`  Desc:    ${plan.description}`);
  }
  console.log(`  Project: ${plan.project_name}`);
  if (dependsOn !== null) {
    const dep = getPlan(dependsOn);
    console.log(`  Depends: #${dependsOn} ${dep?.plan_title ?? "(unknown)"}`);
  }
  console.log(`  ${DIM}Use "tracker plan ${plan.id}" to generate a plan${RESET}`);
}

function cmdPlan(args: string[]) {
  const idStr = args[0];
  if (!idStr) {
    console.error(`${RED}Error: plan requires a task <id>${RESET}`);
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error(`${RED}Error: Invalid id "${idStr}"${RESET}`);
    process.exit(1);
  }

  const plan = getPlan(id);
  if (!plan) {
    console.error(`${RED}Error: Task #${id} not found${RESET}`);
    process.exit(1);
  }

  if (!plan.plan_title) {
    console.error(`${RED}Error: Task #${id} has no title${RESET}`);
    process.exit(1);
  }

  console.log(`${BOLD}▶${RESET} Generating plan for task ${BOLD}#${plan.id}${RESET}: ${plan.plan_title}`);
  console.log(`  ${DIM}Project: ${plan.project_path}${RESET}\n`);

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

  // Spawn Claude with -p flag (print mode) - no session ID needed for one-shot generation
  const claudeArgs = ["-p", prompt];
  const result = spawnSync("claude", claudeArgs, {
    cwd: plan.project_path,
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    console.error(`${RED}✗${RESET} Claude exited with code ${result.status}`);
    process.exit(1);
  }

  const output = result.stdout?.toString() ?? "";

  if (!output.trim()) {
    console.error(`${RED}✗${RESET} Claude produced no output`);
    process.exit(1);
  }

  // Save plan to file
  const plansDir = join(homedir(), ".claude", "plans");
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }

  const slug = slugify(plan.plan_title);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const planFileName = `${slug}-${timestamp}.md`;
  const planPath = join(plansDir, planFileName);

  writeFileSync(planPath, output);
  updatePlanPath(plan.id, planPath);

  console.log(`\n${GREEN}✓${RESET} Plan saved to ${CYAN}${planPath}${RESET}`);
  console.log(`  ${DIM}Use "tracker work ${plan.id}" to start working on the plan${RESET}`);
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
      const worktreeInfo = p.worktree_path ? `\n      ${DIM}Worktree: ${formatWorktreePath(p.worktree_path)}${RESET}` : "";

      // Show dependency info
      let depInfo = "";
      if (p.depends_on_id) {
        const dep = getPlan(p.depends_on_id);
        const depStatus = dep?.status ?? "unknown";
        const isBlocked = p.status === "open" && depStatus !== "in-review" && depStatus !== "completed";
        if (isBlocked) {
          depInfo = `\n      ${YELLOW}⚠ Blocked by #${p.depends_on_id}${RESET} ${DIM}(${depStatus})${RESET}`;
        } else {
          depInfo = `\n      ${DIM}Depends on #${p.depends_on_id}${RESET}`;
        }
      }

      console.log(
        `  ${color}${icon}${RESET} ${BOLD}#${p.id}${RESET} ${title} ${DIM}[${p.status}] ${date}${RESET}${branchInfo}${worktreeInfo}${depInfo}`
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
  const config = loadConfig();

  // Initialize OTel collector
  await initOTelCollector();

  let plans: Plan[];
  if (args.length > 0) {
    // IDs provided directly
    plans = [];
    for (const idStr of args) {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) {
        console.error(`${RED}Error: Invalid id "${idStr}"${RESET}`);
        await shutdownOTelCollector();
        process.exit(1);
      }
      const plan = getPlan(id);
      if (!plan) {
        console.error(`${RED}Error: Plan #${id} not found${RESET}`);
        await shutdownOTelCollector();
        process.exit(1);
      }
      plans.push(plan);
    }
  } else {
    // Interactive selection
    const allPlans = listPlans();
    const openPlans = allPlans.filter((p) => p.status === "open");
    if (openPlans.length === 0) {
      console.log(`${DIM}No open plans available. Use "tracker add" to register a plan.${RESET}`);
      await shutdownOTelCollector();
      return;
    }
    const selected = await selectPlans(allPlans);
    if (selected.length === 0) {
      console.log(`${DIM}No plans selected.${RESET}`);
      await shutdownOTelCollector();
      return;
    }
    plans = selected;
  }

  if (plans.length === 0) {
    console.log(`No plans to work on`);
    await shutdownOTelCollector();
    return;
  }

  // Pre-check usage before starting
  const canProceed = await checkUsageBeforeWork(plans.length, config);
  if (!canProceed) {
    console.error(`Cannot start work due to usage limits`);
    await shutdownOTelCollector();
    process.exit(1);
  }

  // Get OTel environment variables
  const otelEnv = getClaudeOTelEnv();

  // Start work
  if (plans.length === 1) {
    await startWork(plans[0], otelEnv);
  } else {
    await startWorkMultiple(plans, otelEnv);
  }

  // Cleanup
  await shutdownOTelCollector();
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
    console.error(`${DIM}Use "tracker work ${id}" to start working on this plan${RESET}`);
    process.exit(1);
  }

  const config = loadConfig();
  const worktreeEnabled = config.worktree?.enabled ?? true;

  console.log(
    `${BOLD}▶${RESET} Checking out plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  Branch:  ${CYAN}${plan.branch}${RESET}`);
  if (plan.session_id) {
    console.log(`  Session: ${DIM}${plan.session_id}${RESET}`);
  }
  console.log(`  Project: ${DIM}${plan.project_path}${RESET}`);

  let workingDir = plan.project_path;

  // If worktree mode is enabled, create/use a worktree
  if (worktreeEnabled) {
    const gitVersion = checkGitVersion();
    if (!gitVersion.supported) {
      console.log(`  ${YELLOW}⚠${RESET} Git worktrees require git 2.5+ (found ${gitVersion.version}), falling back to branch checkout`);
    } else {
      const expectedPath = getWorktreePath(plan.project_path, plan.id);

      // Check if worktree exists (handles manually deleted worktrees)
      if (worktreeExists(plan.project_path, plan.id)) {
        workingDir = expectedPath;
        // Update DB if worktree_path was not set (e.g., DB reset or manual worktree)
        if (plan.worktree_path !== expectedPath) {
          updateWorktreePath(plan.id, expectedPath);
        }
        console.log(`  ${GREEN}✓${RESET} Using worktree at ${CYAN}${formatWorktreePath(workingDir)}${RESET}`);
      } else {
        // Worktree doesn't exist - create it (handles manually deleted worktrees)
        if (plan.worktree_path) {
          console.log(`  ${YELLOW}⚠${RESET} Worktree was deleted, recreating...`);
        } else {
          console.log(`  ${DIM}Creating worktree...${RESET}`);
        }
        const wtResult = createWorktree(plan.project_path, plan.branch, plan.id);
        if (wtResult.ok) {
          workingDir = wtResult.path;
          updateWorktreePath(plan.id, wtResult.path);
          console.log(`  ${GREEN}✓${RESET} Worktree created at ${CYAN}${formatWorktreePath(wtResult.path)}${RESET}`);
        } else {
          console.log(`  ${YELLOW}⚠${RESET} Failed to create worktree: ${wtResult.error}`);
          console.log(`  ${DIM}Falling back to branch checkout${RESET}`);
          // Clear stale worktree_path from DB
          if (plan.worktree_path) {
            updateWorktreePath(plan.id, null);
          }
        }
      }
    }
  }

  // If not using worktree, checkout the branch in the main repo
  if (workingDir === plan.project_path) {
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
  }

  // Print next steps
  console.log(`\n${BOLD}Next steps:${RESET}`);
  if (workingDir !== plan.project_path) {
    console.log(`  1. Navigate: ${CYAN}cd ${workingDir}${RESET}`);
    console.log(`  2. Resume:   ${CYAN}tracker resume ${plan.id}${RESET}`);
  } else {
    console.log(`  Resume:   ${CYAN}tracker resume ${plan.id}${RESET}`);
  }

  // Show first-time tip if applicable
  showFirstCheckoutMessage(config);

  // Output machine-readable worktree path for shell function
  if (workingDir !== plan.project_path) {
    console.log(`\nWORKTREE_PATH:${workingDir}`);
  }
}

function showFirstCheckoutMessage(config: TrackerConfig) {
  // Skip if shell function already installed
  if (config.shellFunctionInstalled) return;

  // Skip if already shown (first checkout done)
  if (config.firstCheckoutDone) return;

  // Show tip
  console.log(`\n${YELLOW}💡 Tip:${RESET} Enable automatic navigation with:`);
  console.log(`   ${CYAN}tracker install-shell-function --auto${RESET}`);

  // Mark as shown
  config.firstCheckoutDone = true;
  saveConfig(config);
}

function cmdResume(args: string[]) {
  const idStr = args[0];
  if (!idStr) {
    console.error(`${RED}Error: resume requires a plan <id>${RESET}`);
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

  if (!plan.session_id) {
    console.error(`${RED}Error: Plan #${id} has no session ID${RESET}`);
    console.error(`${DIM}Use "tracker work ${id}" to start working on this plan${RESET}`);
    process.exit(1);
  }

  const config = loadConfig();
  const worktreeEnabled = config.worktree?.enabled ?? true;

  // Determine the working directory
  let workingDir = plan.project_path;

  if (worktreeEnabled && plan.worktree_path) {
    // Check if worktree still exists
    if (worktreeExists(plan.project_path, plan.id)) {
      workingDir = plan.worktree_path;
    } else {
      console.error(`${RED}Error: Worktree was deleted${RESET}`);
      console.error(`${DIM}Use "tracker checkout ${id}" to recreate the worktree${RESET}`);
      process.exit(1);
    }
  } else if (!worktreeEnabled && plan.branch) {
    // If worktrees are disabled, check if we're on the correct branch
    const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: plan.project_path,
      stdout: "pipe",
      stderr: "pipe",
    });
    const currentBranch = result.stdout.toString().trim();
    if (currentBranch !== plan.branch) {
      console.error(`${YELLOW}⚠${RESET} Not on plan branch ${CYAN}${plan.branch}${RESET} (on ${CYAN}${currentBranch}${RESET})`);
      console.error(`${DIM}Use "tracker checkout ${id}" to checkout the branch first${RESET}`);
      process.exit(1);
    }
  }

  console.log(
    `${BOLD}▶${RESET} Resuming plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Session: ${plan.session_id}${RESET}`);
  console.log(`  ${DIM}Working dir: ${workingDir}${RESET}`);
  console.log();

  // Resume Claude Code conversation by session ID
  const claudeArgs = ["--resume", plan.session_id];
  if (config.skipPermissions) {
    claudeArgs.push("--dangerously-skip-permissions");
  }
  const claude = spawnSync("claude", claudeArgs, {
    cwd: workingDir,
    stdio: "inherit",
  });

  process.exit(claude.status ?? 0);
}

function cmdInstallShellFunction(args: string[]) {
  const autoMode = args.includes("--auto");
  const forceBash = args.includes("--bash");
  const forceZsh = args.includes("--zsh");

  // Determine shell type
  let shellType: "bash" | "zsh";
  const currentShell = process.env.SHELL ?? "";

  if (forceBash) {
    shellType = "bash";
  } else if (forceZsh) {
    shellType = "zsh";
  } else if (currentShell.endsWith("/zsh")) {
    shellType = "zsh";
  } else if (currentShell.endsWith("/bash")) {
    shellType = "bash";
  } else {
    console.error(`${RED}Error: Could not detect shell type from $SHELL (${currentShell})${RESET}`);
    console.error(`${DIM}Use --bash or --zsh to specify the shell type${RESET}`);
    process.exit(1);
  }

  const functionContent = shellType === "zsh" ? SHELL_FUNCTION_ZSH : SHELL_FUNCTION_BASH;
  const functionExt = shellType === "zsh" ? "zsh" : "sh";
  const rcFile = shellType === "zsh" ? join(homedir(), ".zshrc") : join(homedir(), ".bashrc");

  // Save function to file
  const functionDir = join(homedir(), ".local", "share", "task-tracker");
  const functionPath = join(functionDir, `shell-function.${functionExt}`);

  mkdirSync(functionDir, { recursive: true });
  writeFileSync(functionPath, functionContent);

  console.log(`${GREEN}✓${RESET} Shell function written to ${CYAN}${functionPath}${RESET}`);

  const sourceLine = `source "${functionPath}"`;

  if (autoMode) {
    // Check if already installed
    let rcContent = "";
    try {
      rcContent = readFileSync(rcFile, "utf-8");
    } catch {
      // File doesn't exist, that's fine
    }

    if (rcContent.includes(functionPath)) {
      console.log(`${DIM}Already installed in ${rcFile}${RESET}`);
    } else {
      // Append to RC file
      const appendContent = `\n# Task Tracker shell function\n${sourceLine}\n`;
      appendFileSync(rcFile, appendContent);
      console.log(`${GREEN}✓${RESET} Added to ${CYAN}${rcFile}${RESET}`);
    }

    // Update config
    const config = loadConfig();
    config.shellFunctionInstalled = true;
    saveConfig(config);

    console.log(`\n${BOLD}Activate now:${RESET}`);
    console.log(`  ${CYAN}source ${rcFile}${RESET}`);
    console.log(`\n${DIM}Or restart your terminal${RESET}`);
  } else {
    // Manual mode - print instructions
    console.log(`\n${BOLD}Add this line to your ${rcFile}:${RESET}`);
    console.log(`  ${CYAN}${sourceLine}${RESET}`);
    console.log(`\n${BOLD}Then activate:${RESET}`);
    console.log(`  ${CYAN}source ${rcFile}${RESET}`);
    console.log(`\n${DIM}Or use --auto to install automatically${RESET}`);
  }
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

  // Check if task can be completed (dependency must be completed)
  const canCompleteResult = canComplete(plan.id);
  if (!canCompleteResult.allowed) {
    console.error(`${RED}Error: ${canCompleteResult.reason}${RESET}`);
    process.exit(1);
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
  const hasWorktree = plan.worktree_path && worktreeExists(plan.project_path, plan.id);
  const mergeCwd = hasWorktree ? plan.worktree_path! : cwd;

  console.log(
    `${BOLD}▶${RESET} Completing plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Branch:  ${branch}${RESET}`);
  console.log(`  ${DIM}Project: ${cwd}${RESET}`);
  if (hasWorktree) {
    console.log(`  ${DIM}Worktree: ${formatWorktreePath(plan.worktree_path!)}${RESET}`);
  }
  console.log();

  // Check for uncommitted changes in the worktree (if exists) or main repo
  const status = git(["status", "--porcelain"], mergeCwd);
  if (status.stdout) {
    const location = hasWorktree ? "Worktree" : "Working directory";
    console.log(`${YELLOW}⚠${RESET} ${location} has uncommitted changes:\n`);
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

  // If using worktree, the feature branch is already checked out there
  // If not using worktree, checkout the feature branch in the main repo
  let result;
  if (!hasWorktree) {
    result = git(["checkout", branch], cwd);
    if (!result.ok) {
      console.error(`${RED}✗${RESET} Failed to checkout ${branch}: ${result.stderr}`);
      process.exit(1);
    }
    console.log(`  Checked out ${CYAN}${branch}${RESET}`);
  }

  // Merge main into feature branch (resolve conflicts here)
  // This happens in the worktree if one exists, otherwise in the main repo
  result = git(["merge", "main"], mergeCwd);
  if (!result.ok) {
    console.error(`${RED}✗${RESET} Merge main into ${branch} failed — there may be conflicts:\n${result.stderr}`);
    console.error(`\n${DIM}Resolve conflicts on this branch, commit, then re-run this command.${RESET}`);
    process.exit(1);
  }
  console.log(`  Merged ${CYAN}main${RESET} into ${CYAN}${branch}${RESET}`);

  // If using worktree, we need to go back to main repo for the final merge
  // Checkout main in main repo (should already be there, but ensure it)
  if (!hasWorktree) {
    result = git(["checkout", "main"], cwd);
    if (!result.ok) {
      console.error(`${RED}✗${RESET} Failed to checkout main: ${result.stderr}`);
      process.exit(1);
    }
  }

  // Merge feature branch into main (should be clean now since we merged main into feature first)
  // This always happens in the main repo
  result = git(["merge", branch, "-m", `Merge branch '${branch}'`], cwd);
  if (!result.ok) {
    console.error(`${RED}✗${RESET} Merge into main failed: ${result.stderr}`);
    process.exit(1);
  }
  console.log(`  Merged ${CYAN}${branch}${RESET} into ${CYAN}main${RESET}`);

  // Update status in DB
  updateStatus(plan.id, "completed");
  console.log(`\n${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} → ${GREEN}completed${RESET}`);

  // Optionally cleanup worktree if configured
  const config = loadConfig();
  if (config.worktree?.autoCleanupOnComplete && hasWorktree) {
    console.log(`  ${DIM}Cleaning up worktree...${RESET}`);
    const cleanupResult = removeWorktree(plan.project_path, plan.id);
    if (cleanupResult.ok) {
      updateWorktreePath(plan.id, null);
      console.log(`  ${GREEN}✓${RESET} Removed worktree at ${formatWorktreePath(plan.worktree_path!)}`);
    } else {
      console.log(`  ${YELLOW}⚠${RESET} Failed to remove worktree: ${cleanupResult.error}`);
    }
  }
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

async function cmdCancel(args: string[]) {
  const idStr = args[0];
  if (!idStr) {
    console.error(`${RED}Error: cancel requires a plan <id>${RESET}`);
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

  console.log(
    `${BOLD}▶${RESET} Cancelling plan ${BOLD}#${plan.id}${RESET}: ${plan.plan_title ?? "(untitled)"}`
  );
  console.log(`  ${DIM}Status:  ${plan.status}${RESET}`);
  if (plan.branch) {
    console.log(`  ${DIM}Branch:  ${plan.branch}${RESET}`);
  }
  console.log(`  ${DIM}Project: ${plan.project_path}${RESET}\n`);

  // If there's a branch, check for unmerged commits as a warning
  if (plan.branch) {
    const cwd = plan.project_path;
    const branchCheck = git(["rev-parse", "--verify", plan.branch], cwd);
    if (branchCheck.ok) {
      const logResult = git(["log", "--oneline", "main.." + plan.branch], cwd);
      const commitCount = logResult.stdout ? logResult.stdout.split("\n").length : 0;
      if (commitCount > 0) {
        console.log(`${YELLOW}⚠${RESET} Branch ${CYAN}${plan.branch}${RESET} has ${commitCount} unmerged commit(s):\n`);
        console.log(`${DIM}${logResult.stdout}${RESET}\n`);
      }
    }
  }

  const proceed = await confirm({
    message: `Cancel plan #${id} and delete its branch? This cannot be undone.`,
    default: false,
  });

  if (!proceed) {
    console.log(`${DIM}Aborted.${RESET}`);
    return;
  }

  // Delete the branch if it exists
  if (plan.branch) {
    const cwd = plan.project_path;
    const branchCheck = git(["rev-parse", "--verify", plan.branch], cwd);
    if (branchCheck.ok) {
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

  // Delete the plan from the DB
  deletePlan(id);
  console.log(`\n${GREEN}✓${RESET} Plan ${BOLD}#${plan.id}${RESET} cancelled and removed.`);
}

async function cmdUsage() {
  const config = loadConfig();

  if (!config.usageLimits?.enabled) {
    console.log(`Usage monitoring is disabled`);
    console.log(`Enable with: tracker config usageLimits.enabled true`);
    return;
  }

  await initOTelCollector();
  const tracker = new UsageTracker();
  const limits = buildUsageLimits(config.usageLimits);
  const usage = await tracker.getCurrentUsage(limits);

  console.log(`\n${BOLD}Current Usage:${RESET}`);
  console.log(`  Input tokens/min:  ${Math.floor(usage.inputTokensPerMinute)} / ${limits.maxInputTokensPerMinute}`);
  console.log(`  Requests/min:      ${Math.floor(usage.requestsPerMinute)} / ${limits.maxRequestsPerMinute}`);
  console.log(`  Available tokens:  ${Math.floor(usage.availableInputTokens)}`);
  console.log(`  Total cost:        $${usage.totalCostUSD.toFixed(2)}`);

  await shutdownOTelCollector();
}

function cmdConfig(args: string[]) {
  const config = loadConfig();

  if (args.length === 0) {
    // Show all config values
    console.log(`${BOLD}Config${RESET} ${DIM}(${CONFIG_PATH})${RESET}\n`);
    console.log(JSON.stringify(config, null, 2));
    console.log();
    return;
  }

  const key = args[0];

  // Handle nested keys (e.g., "usageLimits.enabled")
  if (key.includes('.')) {
    const parts = key.split('.');

    if (args.length === 1) {
      // Get nested value
      let value: any = config;
      for (const part of parts) {
        value = value?.[part];
      }
      console.log(`${BOLD}${key}${RESET} = ${JSON.stringify(value)}`);
      return;
    }

    // Set nested value
    const rawValue = args[1];
    let parsed: any;

    // Try to parse as boolean, number, or keep as string
    if (rawValue === "true") parsed = true;
    else if (rawValue === "false") parsed = false;
    else if (rawValue === "null") parsed = null;
    else if (!isNaN(Number(rawValue))) parsed = Number(rawValue);
    else parsed = rawValue;

    // Navigate to parent object
    let obj: any = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in obj)) {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = parsed;

    saveConfig(config);
    console.log(`${GREEN}✓${RESET} ${BOLD}${key}${RESET} = ${JSON.stringify(parsed)}`);
    return;
  }

  // Handle top-level keys
  const typedKey = key as keyof TrackerConfig;
  if (!(typedKey in CONFIG_KEYS)) {
    console.error(`${RED}Error: Unknown config key "${key}"${RESET}`);
    console.error(`${DIM}Valid keys: ${Object.keys(CONFIG_KEYS).join(", ")}, or nested keys like usageLimits.enabled${RESET}`);
    process.exit(1);
  }

  if (args.length === 1) {
    // Get single value
    console.log(`${BOLD}${key}${RESET} = ${JSON.stringify(config[typedKey])}`);
    return;
  }

  // Set value
  const rawValue = args[1];
  const type = CONFIG_KEYS[typedKey];
  let parsed: boolean | number | object;

  if (type === "boolean") {
    if (rawValue === "true") parsed = true;
    else if (rawValue === "false") parsed = false;
    else {
      console.error(`${RED}Error: "${key}" expects a boolean (true/false)${RESET}`);
      process.exit(1);
    }
  } else if (type === "number") {
    parsed = parseInt(rawValue, 10);
    if (isNaN(parsed)) {
      console.error(`${RED}Error: "${key}" expects a number${RESET}`);
      process.exit(1);
    }
  } else {
    console.error(`${RED}Error: Cannot set object values directly, use nested keys like usageLimits.enabled${RESET}`);
    process.exit(1);
  }

  (config as any)[typedKey] = parsed;
  saveConfig(config);
  console.log(`${GREEN}✓${RESET} ${BOLD}${key}${RESET} = ${parsed}`);
}

async function cmdCleanup() {
  const worktreeBase = getWorktreeBase();

  if (!existsSync(worktreeBase)) {
    console.log(`${DIM}No worktrees directory found at ${worktreeBase}${RESET}`);
    return;
  }

  const plans = listPlans();

  // Build a map of projectId -> Set of task IDs for that project
  // This ensures we check both project AND task ID match
  const projectTaskMap = new Map<string, Set<number>>();
  for (const plan of plans) {
    const projectId = getProjectId(plan.project_path);
    if (!projectTaskMap.has(projectId)) {
      projectTaskMap.set(projectId, new Set());
    }
    projectTaskMap.get(projectId)!.add(plan.id);
  }

  console.log(`${BOLD}▶${RESET} Scanning for orphaned worktrees...`);

  let orphanedCount = 0;
  let removedCount = 0;

  // Scan all project directories
  const projectDirs = readdirSync(worktreeBase);
  for (const projectDir of projectDirs) {
    const projectPath = join(worktreeBase, projectDir);
    const projectTaskIds = projectTaskMap.get(projectDir) ?? new Set();

    try {
      const taskDirs = readdirSync(projectPath);
      for (const taskDir of taskDirs) {
        const taskId = parseInt(taskDir, 10);
        if (isNaN(taskId)) continue;

        // Check if this task exists for THIS specific project
        if (!projectTaskIds.has(taskId)) {
          orphanedCount++;
          const wtPath = join(projectPath, taskDir);
          console.log(`  ${YELLOW}○${RESET} Orphaned worktree: ${formatWorktreePath(wtPath)} (task #${taskId} not found for project)`);
        }
      }
    } catch {
      // Skip if not a directory or can't be read
    }
  }

  if (orphanedCount === 0) {
    console.log(`${GREEN}✓${RESET} No orphaned worktrees found`);
    return;
  }

  const proceed = await confirm({
    message: `Remove ${orphanedCount} orphaned worktree(s)?`,
    default: false,
  });

  if (!proceed) {
    console.log(`${DIM}Aborted.${RESET}`);
    return;
  }

  // Remove orphaned worktrees
  for (const projectDir of projectDirs) {
    const projectPath = join(worktreeBase, projectDir);
    const projectTaskIds = projectTaskMap.get(projectDir) ?? new Set();

    try {
      const taskDirs = readdirSync(projectPath);
      for (const taskDir of taskDirs) {
        const taskId = parseInt(taskDir, 10);
        if (isNaN(taskId)) continue;

        // Check if this task exists for THIS specific project
        if (!projectTaskIds.has(taskId)) {
          const wtPath = join(projectPath, taskDir);
          // Find the original project path from any plan with this project
          const samplePlan = plans.find((p) => getProjectId(p.project_path) === projectDir);
          if (samplePlan) {
            const result = removeWorktree(samplePlan.project_path, taskId);
            if (result.ok) {
              console.log(`  ${GREEN}✓${RESET} Removed ${formatWorktreePath(wtPath)}`);
              removedCount++;
            } else {
              console.log(`  ${RED}✗${RESET} Failed to remove ${formatWorktreePath(wtPath)}: ${result.error}`);
            }
          } else {
            // No matching project found - the original project may have been deleted
            // Try to clean up using git worktree prune on any project, then remove directory
            try {
              // First try to prune any stale worktree references
              spawnSync("git", ["worktree", "prune"], { cwd: process.cwd() });
              // Then remove the directory (cross-platform)
              rmSync(wtPath, { recursive: true, force: true });
              console.log(`  ${GREEN}✓${RESET} Removed ${formatWorktreePath(wtPath)}`);
              removedCount++;
            } catch (e: any) {
              console.log(`  ${RED}✗${RESET} Failed to remove ${formatWorktreePath(wtPath)}: ${e.message}`);
            }
          }
        }
      }
    } catch {
      // Skip if not a directory or can't be read
    }
  }

  console.log(`\n${GREEN}✓${RESET} Removed ${removedCount} orphaned worktree(s)`);
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
    if (build.status !== 0) {
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
  process.exit(server.status ?? 0);
}

function cmdSetDependency(args: string[]) {
  const [idStr, depIdStr] = args;
  if (!idStr || !depIdStr) {
    console.error(`${RED}Error: set-dependency requires <id> and <dep-id>${RESET}`);
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  const depId = parseInt(depIdStr, 10);
  if (isNaN(id) || isNaN(depId)) {
    console.error(`${RED}Error: Invalid task IDs${RESET}`);
    process.exit(1);
  }

  try {
    setDependency(id, depId);
    const plan = getPlan(id);
    const dep = getPlan(depId);
    console.log(
      `${GREEN}✓${RESET} Task ${BOLD}#${id}${RESET} now depends on ${BOLD}#${depId}${RESET} "${dep?.plan_title ?? "(unknown)"}"`
    );
    if (dep && dep.status !== "in-review" && dep.status !== "completed") {
      console.log(`  ${YELLOW}⚠${RESET} Task #${id} is blocked until #${depId} reaches "in-review" status`);
    }
  } catch (e: any) {
    console.error(`${RED}Error: ${e.message}${RESET}`);
    process.exit(1);
  }
}

function cmdClearDependency(args: string[]) {
  const idStr = args[0];
  if (!idStr) {
    console.error(`${RED}Error: clear-dependency requires <id>${RESET}`);
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error(`${RED}Error: Invalid task ID "${idStr}"${RESET}`);
    process.exit(1);
  }

  const plan = getPlan(id);
  if (!plan) {
    console.error(`${RED}Error: Task #${id} not found${RESET}`);
    process.exit(1);
  }

  if (!plan.depends_on_id) {
    console.log(`${DIM}Task #${id} has no dependency.${RESET}`);
    return;
  }

  try {
    removeDependency(id);
    console.log(`${GREEN}✓${RESET} Removed dependency from task ${BOLD}#${id}${RESET}`);
  } catch (e: any) {
    console.error(`${RED}Error: ${e.message}${RESET}`);
    process.exit(1);
  }
}

function cmdShowDeps(args: string[]) {
  const idStr = args[0];
  if (!idStr) {
    console.error(`${RED}Error: show-deps requires <id>${RESET}`);
    process.exit(1);
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error(`${RED}Error: Invalid task ID "${idStr}"${RESET}`);
    process.exit(1);
  }

  const plan = getPlan(id);
  if (!plan) {
    console.error(`${RED}Error: Task #${id} not found${RESET}`);
    process.exit(1);
  }

  console.log(`\n${BOLD}Dependency chain for task #${id}:${RESET}\n`);

  // Show the chain this task depends on
  const chain = getDependencyChain(id);
  if (chain.length > 1) {
    console.log(`${BOLD}Depends on:${RESET}`);
    for (let i = 0; i < chain.length - 1; i++) {
      const p = chain[i];
      const indent = "  ".repeat(i);
      const color = statusColor(p.status);
      const icon = statusIcon(p.status);
      console.log(
        `${indent}${color}${icon}${RESET} ${BOLD}#${p.id}${RESET} ${p.plan_title ?? "(untitled)"} ${DIM}[${p.status}]${RESET}`
      );
    }
    // Show the current task
    const color = statusColor(plan.status);
    const icon = statusIcon(plan.status);
    const indent = "  ".repeat(chain.length - 1);
    console.log(
      `${indent}${color}${icon}${RESET} ${BOLD}#${plan.id}${RESET} ${plan.plan_title ?? "(untitled)"} ${DIM}[${plan.status}]${RESET} ← this task`
    );
  } else {
    console.log(`${DIM}No upstream dependencies${RESET}`);
  }

  // Show tasks that depend on this one
  const dependents = getDependents(id);
  if (dependents.length > 0) {
    console.log(`\n${BOLD}Dependents (blocked by this task):${RESET}`);
    for (const p of dependents) {
      const color = statusColor(p.status);
      const icon = statusIcon(p.status);
      console.log(
        `  ${color}${icon}${RESET} ${BOLD}#${p.id}${RESET} ${p.plan_title ?? "(untitled)"} ${DIM}[${p.status}]${RESET}`
      );
    }
  } else {
    console.log(`\n${DIM}No tasks depend on this one${RESET}`);
  }

  console.log();
}

// Main
const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "create":
    cmdCreate(args);
    break;
  case "add":
    cmdAdd(args);
    break;
  case "list":
    cmdList();
    break;
  case "status":
    cmdStatus(args);
    break;
  case "plan":
    cmdPlan(args);
    break;
  case "work":
    await cmdWork(args);
    break;
  case "usage":
    await cmdUsage();
    break;
  case "checkout":
    cmdCheckout(args);
    break;
  case "resume":
    cmdResume(args);
    break;
  case "install-shell-function":
    cmdInstallShellFunction(args);
    break;
  case "complete":
    await cmdComplete(args);
    break;
  case "reset":
    await cmdReset(args);
    break;
  case "cancel":
    await cmdCancel(args);
    break;
  case "cleanup":
    await cmdCleanup();
    break;
  case "set-dependency":
    cmdSetDependency(args);
    break;
  case "clear-dependency":
    cmdClearDependency(args);
    break;
  case "show-deps":
    cmdShowDeps(args);
    break;
  case "config":
    cmdConfig(args);
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
