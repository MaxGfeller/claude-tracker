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
