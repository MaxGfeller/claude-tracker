# Skill: Register Plan in Tracker

## Description
Register a Claude Code plan file in the task tracker database, associating it with the current project.

## Instructions

When this skill is activated:

1. **Determine the plan file path:**
   - If the user provided a path argument, resolve it to an absolute path.
   - If no argument was given, check if you are currently working with a plan file (e.g., one you just created in `~/.claude/plans/`). Use that path.
   - If no plan file can be identified, ask the user to specify the plan file path.

2. **Determine the project directory:**
   - Use the current working directory (`$PWD`).

3. **Register the plan** by executing:
   ```bash
   bun run /Users/mg/projects/private/task-tracker/src/cli.ts add "<plan-file-path>" "<project-dir>"
   ```

4. **Report the result** to the user. Include the plan ID, title, and project name from the output.

## Example

```
User: /tracker:plan ~/.claude/plans/my-feature-plan.md
Agent: runs `bun run .../src/cli.ts add ~/.claude/plans/my-feature-plan.md /current/project`
Agent: "Registered plan #3: 'My Feature Plan' under project my-project"
```
