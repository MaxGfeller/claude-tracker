import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PLANS_DIR = join(homedir(), ".claude", "plans");

export function parsePlanTitle(filePath: string): string | null {
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

export function findPlanByName(name: string): string | null {
  if (!existsSync(PLANS_DIR)) return null;

  const files = readdirSync(PLANS_DIR).filter((f) => f.endsWith(".md"));

  // Exact match first
  const exact = files.find((f) => f === name || f === `${name}.md`);
  if (exact) return join(PLANS_DIR, exact);

  // Partial match
  const partial = files.find((f) => f.toLowerCase().includes(name.toLowerCase()));
  if (partial) return join(PLANS_DIR, partial);

  return null;
}
