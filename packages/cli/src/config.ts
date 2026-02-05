import { join, dirname } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

export const CONFIG_PATH = join(homedir(), ".local", "share", "task-tracker", "config.json");

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
};

export const CONFIG_KEYS: Record<keyof TrackerConfig, "boolean" | "number" | "object"> = {
  skipPermissions: "boolean",
  maxReviewRounds: "number",
  usageLimits: "object",
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
