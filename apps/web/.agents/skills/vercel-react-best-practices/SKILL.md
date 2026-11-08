---
name: vercel-react-best-practices
description: Guide React and TanStack Start performance work involving rendering, data fetching, or bundle size.
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
---

# React and TanStack Start performance

Use these references for the performance problem being addressed. Preserve
behavior and prioritize changes supported by the affected code or measurements.
Account for this project's React Compiler and installed TanStack Start version;
rules written for Next.js Server Components apply to route loaders and server functions.

Read relevant files from rules/ by prefix:

| Concern                           | Prefix     |
| --------------------------------- | ---------- |
| Sequential data loading           | async-     |
| Client bundle size                | bundle-    |
| Server work and serialization     | server-    |
| Client fetching and subscriptions | client-    |
| Re-renders and state              | rerender-  |
| Rendering and hydration           | rendering- |
| JavaScript hot paths              | js-        |
| Advanced hook patterns            | advanced-  |

Each rule contains examples and rationale. The compiled AGENTS.md in this skill
is a full reference for a broad performance audit; it is not a required read for
a focused change. Do not add dependencies or manual memoization solely to satisfy
an example. Verify the relevant behavior and performance impact.
