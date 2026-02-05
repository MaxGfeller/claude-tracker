import { readFileSync } from "fs";

export interface GitignorePattern {
  pattern: string;
  negation: boolean;
  directoryOnly: boolean;
  regex: RegExp;
}

/**
 * Parse a .gitignore file and return an array of patterns
 */
export function parseGitignore(gitignorePath: string): GitignorePattern[] {
  try {
    const content = readFileSync(gitignorePath, "utf-8");
    return parseGitignoreContent(content);
  } catch {
    return [];
  }
}

/**
 * Parse gitignore content string into patterns
 */
export function parseGitignoreContent(content: string): GitignorePattern[] {
  const lines = content.split("\n");
  const patterns: GitignorePattern[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Check for negation
    let pattern = trimmed;
    let negation = false;
    if (pattern.startsWith("!")) {
      negation = true;
      pattern = pattern.slice(1);
    }

    // Check for directory-only pattern
    let directoryOnly = false;
    if (pattern.endsWith("/")) {
      directoryOnly = true;
      pattern = pattern.slice(0, -1);
    }

    // Convert gitignore pattern to regex
    const regex = patternToRegex(pattern);

    patterns.push({
      pattern: trimmed,
      negation,
      directoryOnly,
      regex,
    });
  }

  return patterns;
}

/**
 * Convert a gitignore glob pattern to a regular expression
 */
function patternToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;

  // Handle patterns that start with /
  let anchored = false;
  if (pattern.startsWith("/")) {
    anchored = true;
    pattern = pattern.slice(1);
  }

  // If pattern contains /, it's anchored to root
  if (pattern.includes("/") && !pattern.startsWith("**/")) {
    anchored = true;
  }

  // Convert pattern to regex
  while (i < pattern.length) {
    const char = pattern[i];

    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          // **/ matches any number of directories
          regexStr += "(?:.*/)?";
          i += 3;
          continue;
        } else if (i + 2 === pattern.length) {
          // ** at end matches anything
          regexStr += ".*";
          i += 2;
          continue;
        }
      }
      // Single * matches anything except /
      regexStr += "[^/]*";
    } else if (char === "?") {
      // ? matches any single character except /
      regexStr += "[^/]";
    } else if (char === "[") {
      // Character class - find the closing ]
      const end = pattern.indexOf("]", i);
      if (end === -1) {
        regexStr += "\\[";
      } else {
        const charClass = pattern.slice(i, end + 1);
        regexStr += charClass;
        i = end;
      }
    } else if (char === "/") {
      regexStr += "/";
    } else {
      // Escape regex special characters
      regexStr += escapeRegex(char);
    }

    i++;
  }

  // Build final regex
  if (anchored) {
    return new RegExp(`^${regexStr}(?:/.*)?$`);
  } else {
    return new RegExp(`(?:^|/)${regexStr}(?:/.*)?$`);
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|\\]/g, "\\$&");
}

/**
 * Check if a path matches the gitignore patterns
 */
export function matchesGitignore(
  path: string,
  patterns: GitignorePattern[],
  isDirectory = false
): boolean {
  // Normalize path (remove leading ./)
  let normalizedPath = path;
  if (normalizedPath.startsWith("./")) {
    normalizedPath = normalizedPath.slice(2);
  }

  let matched = false;

  for (const pattern of patterns) {
    // Skip directory-only patterns for files
    if (pattern.directoryOnly && !isDirectory) {
      continue;
    }

    if (pattern.regex.test(normalizedPath)) {
      if (pattern.negation) {
        matched = false;
      } else {
        matched = true;
      }
    }
  }

  return matched;
}
