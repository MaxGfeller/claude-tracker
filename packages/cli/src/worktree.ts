import { existsSync, mkdirSync, cpSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { parseGitignore, matchesGitignore } from "./gitignore";

const WORKTREE_BASE = join(homedir(), ".task-tracker", "worktrees");

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

/**
 * Get the base directory for all worktrees
 */
export function getWorktreeBase(): string {
  return WORKTREE_BASE;
}

/**
 * Generate a unique project identifier from a project path.
 * Uses the last two path components to avoid conflicts.
 */
export function getProjectId(projectPath: string): string {
  const resolved = resolve(projectPath);
  const parts = resolved.split("/").filter(Boolean);
  // Use last 2 components for uniqueness (e.g., "private/task-tracker")
  const key = parts.slice(-2).join("-");
  return key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Get the expected worktree path for a task
 */
export function getWorktreePath(projectPath: string, taskId: number): string {
  const projectId = getProjectId(projectPath);
  return join(WORKTREE_BASE, projectId, String(taskId));
}

/**
 * Check if a worktree exists for a task
 */
export function worktreeExists(projectPath: string, taskId: number): boolean {
  const wtPath = getWorktreePath(projectPath, taskId);
  return existsSync(wtPath) && existsSync(join(wtPath, ".git"));
}

/**
 * Check the git version and return whether worktrees are supported
 */
export function checkGitVersion(): { supported: boolean; version: string } {
  const result = spawnSync("git", ["--version"], { encoding: "utf-8" });
  if (result.status !== 0) {
    return { supported: false, version: "unknown" };
  }

  const match = result.stdout.match(/git version (\d+\.\d+)/);
  if (!match) {
    return { supported: false, version: result.stdout.trim() };
  }

  const version = match[1];
  const [major, minor] = version.split(".").map(Number);
  // git worktree was introduced in git 2.5
  const supported = major > 2 || (major === 2 && minor >= 5);

  return { supported, version };
}

/**
 * List all worktrees for the current git repository
 */
export function listWorktrees(projectPath: string): WorktreeInfo[] {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectPath,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  const blocks = result.stdout.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    let path = "";
    let head = "";
    let branch = "";

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice(9);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice(5);
      } else if (line.startsWith("branch ")) {
        branch = line.slice(7).replace("refs/heads/", "");
      }
    }

    if (path && head) {
      worktrees.push({ path, branch, head });
    }
  }

  return worktrees;
}

/**
 * Create a worktree for a task
 */
export function createWorktree(
  projectPath: string,
  branchName: string,
  taskId: number
): { ok: boolean; path: string; error?: string } {
  const wtPath = getWorktreePath(projectPath, taskId);

  // Check if worktree already exists
  if (worktreeExists(projectPath, taskId)) {
    return { ok: true, path: wtPath };
  }

  // Ensure parent directory exists
  const parentDir = join(WORKTREE_BASE, getProjectId(projectPath));
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // First, ensure the branch exists (create from main if needed)
  const branchCheck = spawnSync("git", ["rev-parse", "--verify", branchName], {
    cwd: projectPath,
    encoding: "utf-8",
  });

  if (branchCheck.status !== 0) {
    // Branch doesn't exist, create it from main
    const createBranch = spawnSync("git", ["branch", branchName, "main"], {
      cwd: projectPath,
      encoding: "utf-8",
    });

    if (createBranch.status !== 0) {
      return {
        ok: false,
        path: wtPath,
        error: `Failed to create branch: ${createBranch.stderr}`,
      };
    }
  }

  // Create the worktree
  const result = spawnSync("git", ["worktree", "add", wtPath, branchName], {
    cwd: projectPath,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    return {
      ok: false,
      path: wtPath,
      error: result.stderr || result.stdout,
    };
  }

  // Copy gitignored files
  copyGitignoredFiles(projectPath, wtPath);

  return { ok: true, path: wtPath };
}

/**
 * Remove a worktree for a task
 */
export function removeWorktree(
  projectPath: string,
  taskId: number
): { ok: boolean; error?: string } {
  const wtPath = getWorktreePath(projectPath, taskId);

  if (!worktreeExists(projectPath, taskId)) {
    return { ok: true }; // Already gone
  }

  // Remove the worktree
  const result = spawnSync("git", ["worktree", "remove", wtPath, "--force"], {
    cwd: projectPath,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout,
    };
  }

  return { ok: true };
}

/**
 * Copy gitignored files (like .env) from main repo to worktree
 */
export function copyGitignoredFiles(srcDir: string, destDir: string): void {
  const gitignorePath = join(srcDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return;
  }

  const patterns = parseGitignore(gitignorePath);
  if (patterns.length === 0) {
    return;
  }

  // Common env files that are usually gitignored and needed
  const commonEnvFiles = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".env.test",
    ".env.test.local",
    ".env.production.local",
    ".envrc",
  ];

  // Copy common env files if they exist and are gitignored
  for (const file of commonEnvFiles) {
    const srcPath = join(srcDir, file);
    const destPath = join(destDir, file);

    if (existsSync(srcPath) && !existsSync(destPath)) {
      // Check if it matches gitignore patterns
      if (matchesGitignore(file, patterns)) {
        try {
          cpSync(srcPath, destPath);
        } catch {
          // Silently ignore copy errors (file may be locked or have permission issues)
        }
      }
    }
  }

  // Also look for any files matching common patterns in root
  let entries: string[];
  try {
    entries = readdirSync(srcDir);
  } catch {
    // If we can't read the source directory, just return
    return;
  }
  for (const entry of entries) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);

    // Skip if already exists in destination
    if (existsSync(destPath)) {
      continue;
    }

    // Get file stats once for all checks
    let fileStat;
    try {
      fileStat = statSync(srcPath);
    } catch {
      // File may have been deleted or is inaccessible - skip it
      continue;
    }

    // Skip directories
    if (fileStat.isDirectory()) {
      continue;
    }

    // Skip if not gitignored
    if (!matchesGitignore(entry, patterns)) {
      continue;
    }

    // Skip large files (> 10MB)
    if (fileStat.size > 10 * 1024 * 1024) {
      continue;
    }

    // Only copy files that look like config/env files
    if (
      entry.startsWith(".") ||
      entry.endsWith(".local") ||
      entry.includes("secret") ||
      entry.includes("credential")
    ) {
      try {
        cpSync(srcPath, destPath);
      } catch {
        // Silently ignore copy errors (file may be locked or have permission issues)
      }
    }
  }
}

/**
 * Get worktree info for a task if it exists
 */
export function getWorktreeInfo(
  projectPath: string,
  taskId: number
): WorktreeInfo | null {
  const wtPath = getWorktreePath(projectPath, taskId);
  const worktrees = listWorktrees(projectPath);
  return worktrees.find((wt) => wt.path === wtPath) ?? null;
}

/**
 * List all worktrees for a project managed by task-tracker
 */
export function listProjectWorktrees(projectPath: string): WorktreeInfo[] {
  const projectId = getProjectId(projectPath);
  const projectWorktreeDir = join(WORKTREE_BASE, projectId);

  if (!existsSync(projectWorktreeDir)) {
    return [];
  }

  const allWorktrees = listWorktrees(projectPath);
  return allWorktrees.filter((wt) => wt.path.startsWith(projectWorktreeDir));
}

/**
 * Check if we're currently inside a worktree
 */
export function isInsideWorktree(cwd: string): boolean {
  return cwd.startsWith(WORKTREE_BASE);
}

/**
 * Get the main repository path from a worktree path
 */
export function getMainRepoFromWorktree(worktreePath: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: worktreePath,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    return null;
  }

  // The git-common-dir points to the .git directory of the main repo
  const gitDir = result.stdout.trim();
  if (gitDir.endsWith("/.git")) {
    return gitDir.slice(0, -5);
  }
  return null;
}

/**
 * Format a worktree path for display (abbreviate home directory)
 */
export function formatWorktreePath(wtPath: string): string {
  const home = homedir();
  if (wtPath.startsWith(home)) {
    return "~" + wtPath.slice(home.length);
  }
  return wtPath;
}
