const activeChildren = new Set<number>();

export function trackChild(pid: number): void {
  activeChildren.add(pid);
}

export function removeChild(pid: number): void {
  activeChildren.delete(pid);
}

export function getActiveChildCount(): number {
  // Prune dead processes via signal 0 (existence check)
  for (const pid of activeChildren) {
    try {
      process.kill(pid, 0);
    } catch {
      activeChildren.delete(pid);
    }
  }
  return activeChildren.size;
}
