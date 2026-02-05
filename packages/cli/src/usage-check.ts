import { UsageTracker } from './usage-tracker';
import type { TrackerConfig } from './config';
import type { UsageLimits } from './types/usage';

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

// Tier-based rate limits (from Claude Code documentation)
const TIER_LIMITS: Record<number, { inputTokens: number; requests: number }> = {
  1: { inputTokens: 5000, requests: 5 },
  2: { inputTokens: 30000, requests: 20 },
  3: { inputTokens: 100000, requests: 30 },
  4: { inputTokens: 400000, requests: 50 },
};

export function buildUsageLimits(config: TrackerConfig['usageLimits']): UsageLimits {
  if (!config) {
    throw new Error('usageLimits config is not defined');
  }

  // Determine tier (default to tier 2 if not specified)
  const tier = config.organizationTier ?? 2;
  const tierLimit = TIER_LIMITS[tier] ?? TIER_LIMITS[2];

  return {
    minAvailableInputTokens: config.minAvailableInputTokens ?? 10000,
    minAvailableRequests: config.minAvailableRequests ?? 5,
    maxCostPerSession: config.maxCostPerSession ?? 1.0,
    maxInputTokensPerMinute: tierLimit.inputTokens,
    maxOutputTokensPerMinute: tierLimit.inputTokens * 4, // Output is typically 4x input limit
    maxRequestsPerMinute: tierLimit.requests,
  };
}

export async function checkUsageBeforeWork(
  planCount: number,
  config: TrackerConfig
): Promise<boolean> {
  if (!config.usageLimits?.enabled) {
    return true;  // Skip check if disabled
  }

  console.log(`\n${DIM}[Checking usage limits...]${RESET}`);

  const tracker = new UsageTracker();
  const limits = buildUsageLimits(config.usageLimits);

  // Check current usage
  const usage = await tracker.getCurrentUsage(limits);
  const usagePercent = Math.floor((usage.inputTokensPerMinute / limits.maxInputTokensPerMinute) * 100);

  console.log(
    `${GREEN}✓${RESET} Current usage: ${Math.floor(usage.inputTokensPerMinute)} / ${limits.maxInputTokensPerMinute} input tokens/min (${usagePercent}%)`
  );

  const check = await tracker.canStartWork(limits);

  if (check.allowed) {
    console.log(`${GREEN}✓${RESET} Available quota sufficient\n`);
    return true;
  }

  // Usage exhausted - wait for reset
  console.log(`${RED}✗${RESET} Rate limit reached: ${check.reason}`);

  if (!check.retryAfter) {
    console.error(`${RED}✗${RESET} Cost limit exceeded - cannot proceed${RESET}`);
    return false;
  }

  const estimatedWait = Math.ceil((check.retryAfter.getTime() - Date.now()) / 1000);
  console.log(`  Need: ${limits.minAvailableInputTokens} tokens`);
  console.log(`  Available: ${Math.floor(usage.availableInputTokens)} tokens\n`);
  console.log(`⏳ Waiting for quota to reset (estimated ${estimatedWait} seconds)...`);

  const success = await tracker.waitForQuota(
    limits,
    config.usageLimits.maxWaitMinutes ?? 10
  );

  if (success) {
    console.log(`\n${GREEN}✓${RESET} Quota reset`);
    const newUsage = await tracker.getCurrentUsage(limits);
    const newPercent = Math.floor((newUsage.inputTokensPerMinute / limits.maxInputTokensPerMinute) * 100);
    console.log(
      `${GREEN}✓${RESET} Current usage: ${Math.floor(newUsage.inputTokensPerMinute)} / ${limits.maxInputTokensPerMinute} input tokens/min (${newPercent}%)\n`
    );
    return true;
  }

  console.error(`\n${RED}✗${RESET} Timeout waiting for quota${RESET}`);
  return false;
}
