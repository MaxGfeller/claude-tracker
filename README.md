# Task Tracker

Orchestrate Claude Code agents to implement plans across multiple projects.

## Overview

Task Tracker is a CLI + web dashboard for managing markdown plan files. It spawns Claude Code workers to implement each plan on a dedicated branch, runs automated review loops, and merges completed work back to main. Plans within the same project run sequentially; plans across different projects run in parallel.

## Prerequisites

- [Bun](https://bun.sh) (runtime & package manager)
- [Git](https://git-scm.com)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command available on PATH)

## Installation

```sh
bun install
bun run build
bun run link
```

This builds the CLI and UI, then links the `tracker` binary globally.

## Quick start

```sh
# 1. Write a plan as a markdown file (title = first # heading)
echo "# Add dark mode support" > plan.md

# 2. Register the plan
tracker add plan.md /path/to/project

# 3. Start a Claude Code worker
tracker work 1

# 4. After review passes, merge to main
tracker complete 1
```

## CLI reference

| Command | Description |
|---|---|
| `tracker add <plan-path> <project-dir>` | Register a plan |
| `tracker list` | List all plans grouped by project |
| `tracker status <id> <status>` | Update plan status (`open`, `in-progress`, `in-review`, `completed`) |
| `tracker work [id...]` | Start Claude Code on plans (interactive picker if no IDs) |
| `tracker checkout <id>` | Checkout plan branch and resume Claude Code conversation |
| `tracker complete [id]` | Merge plan branch into main and mark completed (auto-detects branch if no ID) |
| `tracker complete <id> --db-only` | Mark completed without git operations |
| `tracker reset <id>` | Reset plan to open, optionally deleting its branch |
| `tracker config` | Show all config values |
| `tracker config <key>` | Get a config value |
| `tracker config <key> <value>` | Set a config value |
| `tracker ui [port]` | Launch web dashboard (default port: 3847) |

## Web dashboard

```sh
tracker ui
```

Opens a Kanban board at `http://localhost:3847` showing plans organized by status. Features:

- **Kanban columns** — open, in-progress, in-review, completed
- **Log viewer** — live-streamed worker/reviewer output per plan
- **Start All** — kick off work on all open plans at once

For development with hot-reload: `bun run ui:dev`

## How it works

1. **Plan creation** — Write a markdown file. The first `# Heading` becomes the plan title.
2. **Registration** — `tracker add` stores the plan in the database and records the target project directory.
3. **Worker phase** — `tracker work` creates a branch (`plan/{id}-{slugified-title}`), spawns a Claude Code agent with the plan as its prompt, and commits the result.
4. **Review loop** — A separate Claude Code reviewer agent evaluates the changes. If revisions are needed, the worker agent is re-invoked. This repeats up to `maxReviewRounds` times (default: 5).
5. **Completion** — `tracker complete` merges the plan branch into main and marks the plan as completed.
6. **Parallelism** — Plans in the same project run sequentially (one branch at a time). Plans targeting different projects run in parallel.

## Configuration

Config file: `~/.local/share/task-tracker/config.json`

| Key | Type | Default | Description |
|---|---|---|---|
| `skipPermissions` | boolean | `false` | Skip Claude permission prompts |
| `maxReviewRounds` | number | `5` | Max review iterations per plan |

```sh
tracker config                        # show all
tracker config maxReviewRounds        # get value
tracker config maxReviewRounds 3      # set value
```

## Data storage

| What | Path |
|---|---|
| Database | `~/.local/share/task-tracker/plans.db` |
| Logs | `~/.local/share/task-tracker/logs/{id}-{timestamp}.jsonl` |

## Project structure

```
packages/
├── cli/         # CLI tool (tracker binary)
│   └── src/
│       ├── cli.ts       # Entry point & command routing
│       ├── config.ts    # Config read/write
│       ├── db.ts        # SQLite database
│       ├── plans.ts     # Plan file parsing
│       ├── select.ts    # Interactive plan picker
│       └── work.ts      # Worker & review loop
├── ui/          # Web dashboard (React + Vite)
│   ├── src/             # React frontend
│   └── server/          # HTTP + SSE server
└── skills/      # Claude Code skill definitions
```
