---
name: perf
description: "Analyze bundle size, render performance, and build speed. Use when the app feels slow or before a release. Triggers on: perf, performance, bundle size, slow, optimize."
user-invocable: true
allowed-tools: "Bash(npm :*), Bash(npx :*), Bash(du :*), Read, Grep"
---

# Performance Audit

Quick performance check for Orbit: bundle size, build time, and dependency weight.

## The Job

1. Measure current bundle size (Vite production build)
2. Identify heavy dependencies
3. Check for common perf issues (large imports, missing lazy-loading)
4. Report findings with actionable fixes

## Step 1: Bundle Size

Run `npm run build` and measure output:
```bash
npm run build 2>&1 | tail -20
du -sh dist/
```

Compare against perf budget in `.Codex/rules/perf-budget.md` (< 500 KB gzipped).

## Step 2: Dependency Weight

Check for heavy deps:
```bash
npx vite-bundle-visualizer 2>/dev/null || echo "Install with: npx vite-bundle-visualizer"
```

Also check `node_modules` size and look for duplicates:
```bash
du -sh node_modules/
ls -la node_modules/.package-lock.json 2>/dev/null
```

## Step 3: Code Issues

Search for common perf problems:
- Large inline objects in render (new object every render)
- Missing `useCallback`/`useMemo` on expensive operations
- Components that should be lazy-loaded but aren't
- CSS animations without `will-change` or `transform`

## Step 4: Report

```
## Perf Report

Bundle: X KB (gzipped) — [OK/OVER budget]
Build time: Xs

### Heavy deps
| Package | Size | Action |
|---------|------|--------|

### Issues found
| # | File | Issue | Fix |
|---|------|-------|-----|

### Recommendations
- [ordered by impact]
```

## Checklist

- [ ] Bundle size measured and compared to budget
- [ ] Top 5 heaviest deps identified
- [ ] No lazy-loading opportunities missed
- [ ] Report produced with concrete numbers
