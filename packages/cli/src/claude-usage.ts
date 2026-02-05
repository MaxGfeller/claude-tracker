import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const RESET = "\x1b[0m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

interface ClaudeCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface UsageWindow {
  utilization: number;
  resetsAt: string;
}

export interface ClaudeUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  sevenDaySonnet?: UsageWindow;
  sevenDayOpus?: UsageWindow;
  extraUsage?: {
    isEnabled: boolean;
    monthlyLimit?: number;
    usedCredits?: number;
    utilization?: number;
  };
}

function extractCredentials(parsed: any): ClaudeCredentials | null {
  // Credentials are nested under claudeAiOauth
  const oauth = parsed?.claudeAiOauth ?? parsed;
  if (oauth?.accessToken) {
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
    };
  }
  return null;
}

function readCredentialsFromKeychain(): ClaudeCredentials | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return extractCredentials(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readCredentialsFromFile(): ClaudeCredentials | null {
  try {
    if (!existsSync(CREDENTIALS_PATH)) return null;
    const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
    return extractCredentials(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveCredentialsToFile(creds: ClaudeCredentials): void {
  try {
    writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
  } catch {
    // Best-effort save
  }
}

async function getCredentials(): Promise<ClaudeCredentials> {
  const creds = readCredentialsFromKeychain() ?? readCredentialsFromFile();
  if (!creds) {
    throw new Error("Claude not authenticated — run \"claude\" once to set up credentials");
  }
  return creds;
}

function isExpired(creds: ClaudeCredentials): boolean {
  if (!creds.expiresAt) return false;
  // Consider expired if within 60 seconds of expiry
  return Date.now() >= creds.expiresAt - 60_000;
}

async function refreshToken(creds: ClaudeCredentials): Promise<ClaudeCredentials> {
  if (!creds.refreshToken) {
    throw new Error("Token expired and no refresh token available");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: creds.refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const refreshed: ClaudeCredentials = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? creds.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };

  saveCredentialsToFile(refreshed);
  return refreshed;
}

export async function fetchClaudeUsage(): Promise<ClaudeUsage> {
  let creds = await getCredentials();

  // Auto-refresh if expired
  if (isExpired(creds)) {
    creds = await refreshToken(creds);
  }

  const res = await fetch(USAGE_API_URL, {
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  // If unauthorized, try refreshing once
  if (res.status === 401 && creds.refreshToken) {
    creds = await refreshToken(creds);
    const retry = await fetch(USAGE_API_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });
    if (!retry.ok) {
      const text = await retry.text();
      throw new Error(`Usage API failed (${retry.status}): ${text}`);
    }
    return parseUsageResponse(await retry.json());
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Usage API failed (${res.status}): ${text}`);
  }

  return parseUsageResponse(await res.json());
}

function parseWindow(raw: any): UsageWindow | undefined {
  if (!raw || raw.utilization == null) return undefined;
  return {
    utilization: raw.utilization / 100, // API returns 0-100, normalize to 0-1
    resetsAt: raw.resets_at ?? new Date().toISOString(),
  };
}

function parseUsageResponse(data: any): ClaudeUsage {
  const usage: ClaudeUsage = {};

  usage.fiveHour = parseWindow(data.five_hour);
  usage.sevenDay = parseWindow(data.seven_day);
  usage.sevenDaySonnet = parseWindow(data.seven_day_sonnet);
  usage.sevenDayOpus = parseWindow(data.seven_day_opus);

  if (data.extra_usage) {
    usage.extraUsage = {
      isEnabled: data.extra_usage.is_enabled ?? false,
      monthlyLimit: data.extra_usage.monthly_limit,
      usedCredits: data.extra_usage.used_credits,
      utilization: data.extra_usage.utilization,
    };
  }

  return usage;
}

/**
 * Check usage before starting work. Returns true if work can proceed.
 * Warns at >= 80% 5-hour utilization, blocks at >= 95%.
 * Gracefully allows work if credentials are unavailable.
 */
export async function checkUsageBeforeWork(): Promise<boolean> {
  try {
    const usage = await fetchClaudeUsage();

    if (usage.fiveHour) {
      const pct = Math.round(usage.fiveHour.utilization * 100);
      if (pct >= 95) {
        console.error(
          `${RED}⚠ Usage at ${pct}% — rate limit likely. Wait for reset before starting work.${RESET}`
        );
        return false;
      }
      if (pct >= 80) {
        console.log(
          `${YELLOW}⚠ Usage at ${pct}% of 5-hour window — you may hit rate limits.${RESET}`
        );
      }
    }

    return true;
  } catch {
    // If we can't check usage, allow work to proceed
    return true;
  }
}
