import { Badge } from "./ui/badge";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { label: "Open", variant: "outline" },
  "in-progress": { label: "In Progress", variant: "default" },
  "in-review": { label: "In Review", variant: "secondary" },
  completed: { label: "Completed", variant: "default" },
};

const statusColors: Record<string, string> = {
  open: "border-yellow-500 text-yellow-700",
  "in-progress": "bg-blue-600 text-white hover:bg-blue-600",
  "in-review": "bg-cyan-600 text-white hover:bg-cyan-600",
  completed: "bg-green-600 text-white hover:bg-green-600",
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { label: status, variant: "outline" as const };
  const color = statusColors[status] ?? "";

  return (
    <Badge variant={config.variant} className={color}>
      {config.label}
    </Badge>
  );
}
