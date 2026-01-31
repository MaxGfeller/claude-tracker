import { join, dirname } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

export const CONFIG_PATH = join(homedir(), ".local", "share", "task-tracker", "config.json");

export interface TrackerConfig {
  skipPermissions?: boolean;
  maxReviewRounds?: number;
}

const DEFAULTS: TrackerConfig = {
  skipPermissions: false,
  maxReviewRounds: 5,
};

export const CONFIG_KEYS: Record<keyof TrackerConfig, "boolean" | "number"> = {
  skipPermissions: "boolean",
  maxReviewRounds: "number",
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
