import type { UsageMetrics, UsageLimits } from './types/usage';

async function queryPrometheus(query: string): Promise<any> {
  try {
    const response = await fetch(`http://localhost:9464/api/v1/query?query=${encodeURIComponent(query)}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export class UsageTracker {
  async getCurrentUsage(limits: UsageLimits): Promise<UsageMetrics> {
    // Query Prometheus for usage metrics
    const [inputTokensResult, outputTokensResult, requestsResult, costResult] = await Promise.all([
      queryPrometheus('rate(claude_code_token_usage{type="input"}[1m]) * 60'),
      queryPrometheus('rate(claude_code_token_usage{type="output"}[1m]) * 60'),
      queryPrometheus('rate(claude_code_session_count[1m]) * 60'),
      queryPrometheus('sum(claude_code_cost_usage)'),
    ]);

    // Parse results (defaulting to 0 if no data)
    const inputTokensPerMinute = inputTokensResult?.data?.result?.[0]?.value?.[1] ?? 0;
    const outputTokensPerMinute = outputTokensResult?.data?.result?.[0]?.value?.[1] ?? 0;
    const requestsPerMinute = requestsResult?.data?.result?.[0]?.value?.[1] ?? 0;
    const totalCostUSD = costResult?.data?.result?.[0]?.value?.[1] ?? 0;

    // Calculate available quota
    const availableInputTokens = Math.max(0, limits.maxInputTokensPerMinute - inputTokensPerMinute);
    const availableRequests = Math.max(0, limits.maxRequestsPerMinute - requestsPerMinute);

    // Estimate next reset (rate limits reset on sliding window, so we estimate 60s)
    const nextResetTime = inputTokensPerMinute > 0 || requestsPerMinute > 0
      ? new Date(Date.now() + 60000)
      : null;

    return {
      inputTokensPerMinute,
      outputTokensPerMinute,
      requestsPerMinute,
      totalCostUSD,
      availableInputTokens,
      availableRequests,
      nextResetTime,
    };
  }

  async canStartWork(limits: UsageLimits): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: Date;
  }> {
    const usage = await this.getCurrentUsage(limits);

    // Check if enough quota available
    if (usage.availableInputTokens < limits.minAvailableInputTokens) {
      return {
        allowed: false,
        reason: `Insufficient tokens (need ${limits.minAvailableInputTokens}, have ${Math.floor(usage.availableInputTokens)})`,
        retryAfter: usage.nextResetTime ?? undefined,
      };
    }

    if (usage.availableRequests < limits.minAvailableRequests) {
      return {
        allowed: false,
        reason: `Insufficient requests (need ${limits.minAvailableRequests}, have ${Math.floor(usage.availableRequests)})`,
        retryAfter: usage.nextResetTime ?? undefined,
      };
    }

    if (usage.totalCostUSD >= limits.maxCostPerSession) {
      return {
        allowed: false,
        reason: `Cost limit exceeded ($${usage.totalCostUSD.toFixed(2)} / $${limits.maxCostPerSession.toFixed(2)})`,
      };
    }

    return { allowed: true };
  }

  async waitForQuota(limits: UsageLimits, maxWaitMinutes: number): Promise<boolean> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitMinutes * 60 * 1000;
    const pollIntervalMs = 5000; // 5 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const check = await this.canStartWork(limits);
      if (check.allowed) {
        return true;
      }

      // Calculate progress
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, Math.floor((elapsed / maxWaitMs) * 100));
      const remaining = Math.ceil((maxWaitMs - elapsed) / 1000);

      // Show progress bar
      const barWidth = 10;
      const filled = Math.floor((progress / 100) * barWidth);
      const bar = '■'.repeat(filled) + '□'.repeat(barWidth - filled);

      process.stdout.write(`\r[${bar}] ${progress}% - ${remaining}s remaining`);

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    process.stdout.write('\n');
    return false;
  }
}
