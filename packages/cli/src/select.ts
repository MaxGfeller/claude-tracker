import { checkbox } from "@inquirer/prompts";
import type { Plan } from "./db";

export async function selectPlans(plans: Plan[]): Promise<Plan[]> {
  const openPlans = plans.filter((p) => p.status === "open");

  if (openPlans.length === 0) {
    return [];
  }

  const selected = await checkbox({
    message: "Select plans to work on:",
    choices: openPlans.map((p) => ({
      name: `#${p.id} ${p.plan_title ?? "(untitled)"} — ${p.project_name ?? p.project_path}`,
      value: p,
    })),
  });

  return selected;
}
