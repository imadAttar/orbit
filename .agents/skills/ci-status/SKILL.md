---
name: ci-status
description: Check latest CI run status, show job results and artifact links
triggers:
  - ci status
  - check ci
  - build status
---

# CI Status

Quick check of the latest CI run.

## Steps

1. `gh run list --repo imadAttar/orbit --limit 1` — get latest run
2. `gh run view <ID>` — show jobs status + annotations
3. If failed: `gh run view <ID> --log-failed | tail -20` — show error
4. If success: list artifacts with sizes via `gh api repos/.../actions/runs/<ID>/artifacts`
5. Output a concise summary table
