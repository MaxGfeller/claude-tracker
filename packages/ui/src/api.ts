export interface Plan {
  id: number;
  plan_path: string;
  plan_title: string | null;
  project_path: string;
  project_name: string | null;
  status: string;
  branch: string | null;
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

export function planLogsURL(id: number): string {
  return `/api/plans/${id}/logs`;
}
