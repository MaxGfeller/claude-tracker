import { join, dirname } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

export const CONFIG_PATH = join(homedir(), ".local", "share", "task-tracker", "config.json");

export interface WorktreeConfig {
  enabled: boolean;
  basePath: string;
  copyGitignored: boolean;
  autoCleanupOnComplete: boolean;
}

export interface TrackerConfig {
  skipPermissions?: boolean;
  maxReviewRounds?: number;
  usageLimits?: {
    enabled: boolean;
    minAvailableInputTokens: number;
    minAvailableRequests: number;
    maxCostPerSession: number;
    maxWaitMinutes: number;
    organizationTier: 1 | 2 | 3 | 4 | null;
  };
  worktree?: WorktreeConfig;
  shellFunctionInstalled?: boolean;
  firstCheckoutDone?: boolean;
}

const DEFAULTS: TrackerConfig = {
  skipPermissions: false,
  maxReviewRounds: 5,
  usageLimits: {
    enabled: true,
    minAvailableInputTokens: 10000,
    minAvailableRequests: 5,
    maxCostPerSession: 1.0,
    maxWaitMinutes: 10,
    organizationTier: null,
  },
  worktree: {
    enabled: true,
    basePath: "~/.task-tracker/worktrees",
    copyGitignored: true,
    autoCleanupOnComplete: false,
  },
};

export const CONFIG_KEYS: Record<keyof TrackerConfig, "boolean" | "number" | "object"> = {
  skipPermissions: "boolean",
  maxReviewRounds: "number",
  usageLimits: "object",
  worktree: "object",
  shellFunctionInstalled: "boolean",
  firstCheckoutDone: "boolean",
};

export function loadConfig(): TrackerConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: TrackerConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
