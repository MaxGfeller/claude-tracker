export interface UsageMetrics {
  inputTokensPerMinute: number;
  outputTokensPerMinute: number;
  requestsPerMinute: number;
  totalCostUSD: number;
  availableInputTokens: number;
  availableRequests: number;
  nextResetTime: Date | null;
}

export interface UsageLimits {
  minAvailableInputTokens: number;
  minAvailableRequests: number;
  maxCostPerSession: number;
  maxInputTokensPerMinute: number;  // Tier-based limit
  maxOutputTokensPerMinute: number;
  maxRequestsPerMinute: number;
}
