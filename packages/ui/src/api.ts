export interface Plan {
  id: number;
  plan_path: string;
  plan_title: string | null;
  description: string | null;
  project_path: string;
  project_name: string | null;
  status: string;
  branch: string | null;
  session_id: string | null;
  planning_session_id: string | null;
  worktree_path: string | null;
  depends_on_id: number | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch("/api/plans");
  if (!res.ok) throw new Error(`Failed to fetch plans: ${res.status}`);
  return res.json();
}

export async function fetchPlan(id: number): Promise<Plan> {
  const res = await fetch(`/api/plans/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch plan: ${res.status}`);
  return res.json();
}

export async function startPlanWork(id: number): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`/api/plans/${id}/work`, { method: "POST" });
  return res.json();
}

export async function startAllWork(): Promise<{ ok: boolean; started: number[]; message: string }> {
  const res = await fetch("/api/plans/work-all", { method: "POST" });
  return res.json();
}

export function planLogsURL(id: number): string {
  return `/api/plans/${id}/logs`;
}

export async function createTask(
  title: string,
  projectPath: string,
  projectName?: string,
  description?: string,
  dependsOnId?: number
): Promise<Plan> {
  const res = await fetch("/api/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, projectPath, projectName, description, dependsOnId }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `Failed to create task: ${res.status}`);
  }
  return res.json();
}

export async function generatePlan(id: number): Promise<{ ok: boolean; message: string; planPath?: string }> {
  const res = await fetch(`/api/plans/${id}/plan`, { method: "POST" });
  return res.json();
}

export async function fetchPlanContent(id: number): Promise<string> {
  const res = await fetch(`/api/plans/${id}/plan-content`);
  if (!res.ok) {
    throw new Error(`Failed to fetch plan content: ${res.status}`);
  }
  return res.text();
}

export function planChatURL(id: number): string {
  return `/api/plans/${id}/chat`;
}

export async function deleteTask(id: number): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`/api/plans/${id}`, { method: "DELETE" });
  return res.json();
}

export interface UsageData {
  enabled: boolean;
  message?: string;
  error?: string;
  usage?: {
    inputTokensPerMinute: number;
    requestsPerMinute: number;
    totalCostUSD: number;
    availableInputTokens: number;
    availableRequests: number;
    usagePercent: number;
  };
  limits?: {
    maxInputTokensPerMinute: number;
    maxRequestsPerMinute: number;
    maxCostPerSession: number;
    minAvailableInputTokens: number;
    minAvailableRequests: number;
  };
  config?: any;
}

export async function fetchUsage(): Promise<UsageData> {
  const res = await fetch("/api/usage");
  if (!res.ok) throw new Error(`Failed to fetch usage: ${res.status}`);
  return res.json();
}

// ============ Dependency Management ============

export async function setDependency(
  taskId: number,
  dependsOnId: number | null
): Promise<{ ok: boolean; plan?: Plan; error?: string }> {
  const res = await fetch(`/api/plans/${taskId}/dependency`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dependsOnId }),
  });
  return res.json();
}

export async function getDependency(taskId: number): Promise<{ dependency: Plan | null }> {
  const res = await fetch(`/api/plans/${taskId}/dependency`);
  if (!res.ok) throw new Error(`Failed to fetch dependency: ${res.status}`);
  return res.json();
}

export async function getDependents(taskId: number): Promise<{ dependents: Plan[] }> {
  const res = await fetch(`/api/plans/${taskId}/dependents`);
  if (!res.ok) throw new Error(`Failed to fetch dependents: ${res.status}`);
  return res.json();
}

export async function canStartWork(taskId: number): Promise<{
  allowed: boolean;
  reason?: string;
  blockedBy?: { id: number; title: string | null; status: string };
}> {
  const res = await fetch(`/api/plans/${taskId}/can-start`);
  if (!res.ok) throw new Error(`Failed to check can-start: ${res.status}`);
  return res.json();
}
