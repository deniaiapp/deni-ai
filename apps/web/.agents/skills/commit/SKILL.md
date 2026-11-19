---
name: commit
description: Prepare or create a scoped conventional commit when requested in this repository.
---

Prepare a scoped conventional commit using the current diff and recent commit
style. Follow the root AGENTS.md branch and promotion policy.

Inspect staged, unstaged, and untracked changes before staging relevant files;
exclude secrets and unrelated work. A request for a message alone does not
authorize a commit. When committing is requested, create it and verify the
resulting commit and working-tree state.
