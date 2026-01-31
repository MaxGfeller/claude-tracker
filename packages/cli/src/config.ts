import { join } from "path";
import { homedir } from "os";
import { readFileSync } from "fs";

export const CONFIG_PATH = join(homedir(), ".local", "share", "task-tracker", "config.json");

export interface TrackerConfig {
  skipPermissions?: boolean;
}

const DEFAULTS: TrackerConfig = {
  skipPermissions: false,
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
