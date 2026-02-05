import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DB_DIR = join(homedir(), ".local", "share", "task-tracker");
const DB_PATH = join(DB_DIR, "plans.db");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");

  _db.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_path TEXT NOT NULL,
      plan_title TEXT,
      project_path TEXT NOT NULL,
      project_name TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migrations: add columns if missing
  const cols = _db.prepare("PRAGMA table_info(plans)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "branch")) {
    _db.run("ALTER TABLE plans ADD COLUMN branch TEXT");
  }
  if (!cols.some((c) => c.name === "session_id")) {
    _db.run("ALTER TABLE plans ADD COLUMN session_id TEXT");
  }
  if (!cols.some((c) => c.name === "planning_session_id")) {
    _db.run("ALTER TABLE plans ADD COLUMN planning_session_id TEXT");
  }
  if (!cols.some((c) => c.name === "description")) {
    _db.run("ALTER TABLE plans ADD COLUMN description TEXT");
  }
  if (!cols.some((c) => c.name === "worktree_path")) {
    _db.run("ALTER TABLE plans ADD COLUMN worktree_path TEXT");
  }
  if (!cols.some((c) => c.name === "depends_on_id")) {
    _db.run("ALTER TABLE plans ADD COLUMN depends_on_id INTEGER REFERENCES plans(id)");
  }

  return _db;
}

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

export function addPlan(
  planPath: string,
  projectPath: string,
  planTitle?: string,
  projectName?: string
): Plan {
  const db = getDb();
  const name = projectName ?? projectPath.split("/").pop() ?? projectPath;

  const stmt = db.prepare(`
    INSERT INTO plans (plan_path, plan_title, project_path, project_name)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(planPath, planTitle ?? null, projectPath, name);

  const last = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(last.id) as Plan;
}

export function listPlans(): Plan[] {
  const db = getDb();
  return db.prepare("SELECT * FROM plans ORDER BY project_name, created_at DESC").all() as Plan[];
}

export function updateStatus(id: number, status: string): Plan | null {
  const db = getDb();
  const valid = ["open", "in-progress", "completed", "in-review"];
  if (!valid.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${valid.join(", ")}`);
  }

  db.prepare(`
    UPDATE plans SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, id);

  return db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
}

export function getPlan(id: number): Plan | null {
  const db = getDb();
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
}

export function updateBranch(id: number, branch: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE plans SET branch = ?, updated_at = datetime('now') WHERE id = ?
  `).run(branch, id);
}

export function updateSessionId(id: number, sessionId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE plans SET session_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(sessionId, id);
}

export function deletePlan(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM plans WHERE id = ?").run(id);
}

export function getPlansByProject(projectPath: string): Plan[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM plans WHERE project_path = ? ORDER BY created_at DESC")
    .all(projectPath) as Plan[];
}

export function createTask(
  projectPath: string,
  title: string,
  projectName?: string,
  description?: string
): Plan {
  const db = getDb();
  const name = projectName ?? projectPath.split("/").pop() ?? projectPath;

  const stmt = db.prepare(`
    INSERT INTO plans (plan_path, plan_title, project_path, project_name, description)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run("", title, projectPath, name, description ?? null);

  const last = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(last.id) as Plan;
}

export function updatePlanPath(id: number, planPath: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE plans SET plan_path = ?, updated_at = datetime('now') WHERE id = ?
  `).run(planPath, id);
}

export function updatePlanningSessionId(id: number, sessionId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE plans SET planning_session_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(sessionId, id);
}

export function updatePlanTitle(id: number, title: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE plans SET plan_title = ?, updated_at = datetime('now') WHERE id = ?
  `).run(title, id);
}

export function updateWorktreePath(id: number, worktreePath: string | null): void {
  const db = getDb();
  db.prepare(`
    UPDATE plans SET worktree_path = ?, updated_at = datetime('now') WHERE id = ?
  `).run(worktreePath, id);
}

// ============ Dependency Management Functions ============

/**
 * Set or update a task's dependency. Pass null to clear the dependency.
 * Validates that the dependency is in the same project and doesn't create a cycle.
 */
export function setDependency(taskId: number, dependsOnId: number | null): void {
  const db = getDb();
  const task = getPlan(taskId);
  if (!task) {
    throw new Error(`Task #${taskId} not found`);
  }

  if (dependsOnId !== null) {
    const dependency = getPlan(dependsOnId);
    if (!dependency) {
      throw new Error(`Dependency task #${dependsOnId} not found`);
    }

    // Validate same project
    if (task.project_path !== dependency.project_path) {
      throw new Error(`Task #${taskId} and #${dependsOnId} are in different projects`);
    }

    // Validate no self-dependency
    if (taskId === dependsOnId) {
      throw new Error(`Task cannot depend on itself`);
    }

    // Validate no circular dependency
    if (wouldCreateCycle(taskId, dependsOnId)) {
      throw new Error(`Setting this dependency would create a circular dependency`);
    }
  }

  db.prepare(`
    UPDATE plans SET depends_on_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(dependsOnId, taskId);
}

/**
 * Clear a task's dependency.
 */
export function removeDependency(taskId: number): void {
  setDependency(taskId, null);
}

/**
 * Get the task that this task depends on (if any).
 */
export function getDependency(taskId: number): Plan | null {
  const task = getPlan(taskId);
  if (!task || !task.depends_on_id) {
    return null;
  }
  return getPlan(task.depends_on_id);
}

/**
 * Get all tasks that depend on this task.
 */
export function getDependents(taskId: number): Plan[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM plans WHERE depends_on_id = ? ORDER BY created_at DESC")
    .all(taskId) as Plan[];
}

/**
 * Check if setting taskId to depend on dependsOnId would create a circular dependency.
 * Uses DFS to traverse the dependency chain starting from dependsOnId.
 */
export function wouldCreateCycle(taskId: number, dependsOnId: number): boolean {
  const visited = new Set<number>();
  let current: number | null = dependsOnId;

  while (current !== null) {
    if (current === taskId) {
      return true; // Cycle detected
    }
    if (visited.has(current)) {
      break; // Already checked this path
    }
    visited.add(current);

    const task = getPlan(current);
    current = task?.depends_on_id ?? null;
  }

  return false;
}

/**
 * Check if a task can start work (dependency is in "in-review" or "completed").
 * Returns true if the task has no dependency or the dependency is ready.
 */
export function canStartWork(taskId: number): { allowed: boolean; reason?: string; blockedBy?: Plan } {
  const task = getPlan(taskId);
  if (!task) {
    return { allowed: false, reason: `Task #${taskId} not found` };
  }

  if (!task.depends_on_id) {
    return { allowed: true };
  }

  const dependency = getPlan(task.depends_on_id);
  if (!dependency) {
    return { allowed: true }; // Dependency was deleted
  }

  const readyStatuses = ["in-review", "completed"];
  if (readyStatuses.includes(dependency.status)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Blocked by task #${dependency.id} "${dependency.plan_title}" (status: ${dependency.status})`,
    blockedBy: dependency,
  };
}

/**
 * Check if a task can be completed (dependency must be "completed").
 * Returns true if the task has no dependency or the dependency is completed.
 */
export function canComplete(taskId: number): { allowed: boolean; reason?: string; blockedBy?: Plan } {
  const task = getPlan(taskId);
  if (!task) {
    return { allowed: false, reason: `Task #${taskId} not found` };
  }

  if (!task.depends_on_id) {
    return { allowed: true };
  }

  const dependency = getPlan(task.depends_on_id);
  if (!dependency) {
    return { allowed: true }; // Dependency was deleted
  }

  if (dependency.status === "completed") {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Cannot complete: dependency #${dependency.id} "${dependency.plan_title}" is not completed (status: ${dependency.status})`,
    blockedBy: dependency,
  };
}

/**
 * Get all tasks that are blocked by incomplete dependencies.
 */
export function getBlockedTasks(): Plan[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.* FROM plans p
    INNER JOIN plans dep ON p.depends_on_id = dep.id
    WHERE p.status = 'open'
    AND dep.status NOT IN ('in-review', 'completed')
    ORDER BY p.created_at DESC
  `).all() as Plan[];
}

/**
 * Get open tasks that have no unmet dependencies (can be worked on).
 */
export function getUnblockedOpenTasks(): Plan[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.* FROM plans p
    LEFT JOIN plans dep ON p.depends_on_id = dep.id
    WHERE p.status = 'open'
    AND (p.depends_on_id IS NULL OR dep.status IN ('in-review', 'completed'))
    ORDER BY p.created_at DESC
  `).all() as Plan[];
}

/**
 * Get the full dependency chain for a task (from root to task).
 * Returns an array where the first element is the root dependency and the last is the task itself.
 */
export function getDependencyChain(taskId: number): Plan[] {
  const chain: Plan[] = [];
  const visited = new Set<number>();
  let current: Plan | null = getPlan(taskId);

  // First, collect the chain in reverse order (from task to root)
  while (current && !visited.has(current.id)) {
    chain.unshift(current);
    visited.add(current.id);
    current = current.depends_on_id ? getPlan(current.depends_on_id) : null;
  }

  return chain;
}
