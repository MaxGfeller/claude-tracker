#!/usr/bin/env bun

import { addPlan, listPlans, updateStatus, type Plan } from "./db";
import { parsePlanTitle } from "./plans";
import { existsSync } from "fs";
import { resolve } from "path";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

function statusColor(status: string): string {
  switch (status) {
    case "open":
      return YELLOW;
    case "in-progress":
      return BLUE;
    case "completed":
      return GREEN;
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
  tracker status <id> <status>            Update plan status (open|in-progress|completed)

${BOLD}Examples:${RESET}
  tracker add ~/.claude/plans/my-plan.md /path/to/project
  tracker list
  tracker status 1 in-progress`);
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
      console.log(
        `  ${color}${icon}${RESET} ${BOLD}#${p.id}${RESET} ${title} ${DIM}[${p.status}] ${date}${RESET}`
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
