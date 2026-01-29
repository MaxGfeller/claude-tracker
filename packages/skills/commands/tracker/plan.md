---
name: tracker:plan
description: Register the current plan in the tracker database
argument-hint: "<plan-file-path>"
---

# Register Plan in Tracker

When the user invokes `/tracker:plan`, do the following:

1. **Identify the plan file path.** Check if an argument was provided. If so, use that as the plan file path. Otherwise, look at your current session context — if you just created or are working with a plan file in `~/.claude/plans/`, use that path.

2. **Identify the project directory.** Use the current working directory as the project directory.

3. **Register the plan** by running:
   ```bash
   tracker add <plan-file-path> <project-dir>
   ```

4. **Report the result** back to the user, confirming the plan was registered with its ID and title.

If no plan file can be determined, ask the user to provide the path to the plan file as an argument.
