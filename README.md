# Task Tracker

Run multiple Claude Code plans in parallel, review them when ready, and merge with a single command.

## How it works

You plan features in Claude Code as you normally would. When Claude Code presents a plan you're happy with, run `/tracker-plan` to register it as a task. Then run `tracker work` to select one or more tasks to kick off -- tracker creates a dedicated branch for each, spawns Claude Code workers, and runs automated review loops. Multiple tasks can run in parallel across different projects.

When you're ready to review, `tracker checkout <id>` switches to the feature branch and resumes the Claude Code conversation so you can inspect changes interactively. Once everything looks good, `tracker complete` merges the branch into main and closes the task.

```
Plan in Claude Code ──► /tracker-plan ──► tracker work ──► tracker checkout <id> ──► tracker complete
                         (register)     (implement +       (review changes)         (merge & close)
                                         auto-review)
```

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
# 1. Inside a Claude Code session, after a plan is presented:
/tracker-plan

# 2. Start a worker to implement it (or use the web dashboard)
tracker work 1

# 3. Check on the task and review changes interactively
tracker checkout 1

# 4. When everything looks good, merge to main
tracker complete
```

You can queue up several plans and run them all at once:

```sh
tracker work          # interactive picker
tracker work 1 2 3    # start specific tasks
```

## CLI reference

| Command | Description |
|---|---|
| `tracker add <plan-path> <project-dir>` | Register a plan (or use `/tracker-plan` from Claude Code) |
| `tracker list` | List all plans grouped by project |
| `tracker status <id> <status>` | Update plan status (`open`, `in-progress`, `in-review`, `completed`) |
| `tracker work [id...]` | Start Claude Code on plans (interactive picker if no IDs) |
| `tracker checkout <id>` | Switch to plan branch and resume the Claude Code conversation |
| `tracker complete [id]` | Merge plan branch into main and mark completed (auto-detects from current branch) |
| `tracker complete <id> --db-only` | Mark completed without git operations |
| `tracker reset <id>` | Reset plan to open, optionally deleting its branch |
| `tracker cancel <id>` | Cancel a running worker |
| `tracker config` | Show all config values |
| `tracker config <key>` | Get a config value |
| `tracker config <key> <value>` | Set a config value |
| `tracker ui [port]` | Launch web dashboard (default port: 3847) |

## Web dashboard

```sh
tracker ui
```

Opens a Kanban board at `http://localhost:3847` showing plans organized by status. Features:

- **Kanban columns** -- open, in-progress, in-review, completed
- **Log viewer** -- live-streamed worker/reviewer output per plan
- **Start All** -- kick off work on all open plans at once

For development with hot-reload: `bun run ui:dev`

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
