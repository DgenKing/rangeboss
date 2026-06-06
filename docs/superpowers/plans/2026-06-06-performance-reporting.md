# Performance Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

### Task 1: Risk-Adjusted Metrics

**Files:**
- Create: `packages/core/performance.ts`
- Modify: `packages/core/backtest.ts`
- Modify: `packages/core/portfolio.ts`
- Test: `packages/core/core.test.ts`

- [x] Add failing tests for Sharpe, Sortino, UTC daily equity returns, and unchanged portfolio performance.
- [x] Run `bun test packages/core/core.test.ts` and confirm the new tests fail because reporting helpers and fields do not exist.
- [x] Implement reporting-only metric helpers and expose ratios in token and portfolio summaries.
- [x] Run `bun test packages/core/core.test.ts` and confirm all tests pass.

### Task 2: Complete Executed-Trade Ledgers

**Files:**
- Modify: `packages/monitor/api.ts`
- Modify: `packages/web/app/page.tsx`
- Modify: `packages/web/components/PortfolioView.tsx`

- [x] Stop truncating portfolio closed trades in the API response while retaining timeline and decision compaction.
- [x] Show Sharpe and Sortino in both views.
- [x] Add a full scrollable portfolio ledger with all executed trade details.
- [x] Add the authoritative portfolio ledger filtered by token beneath each token backtest.
- [x] Preserve the existing strategy backtest evidence and allocation board.

### Task 3: Documentation

**Files:**
- Modify: `README.md`

- [x] Document all timeframes, regime rules, strategy entries and exits, allocation rules, friction, metrics, ledgers, and limitations.

### Task 4: Verification and Publish

- [x] Run `bun run check`, the web production build, and `git diff --check`.
- [x] Compare live portfolio performance before and after the reporting change.
- [x] Verify desktop and mobile views in the in-app browser.
- [ ] Commit, push, and update PR #1.
