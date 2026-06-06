# Shared-Capital Portfolio Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authoritative `$1,000` shared-capital portfolio simulation and portfolio-first dashboard across every configured symbol.

**Architecture:** A new core portfolio module runs one shared chronological simulation using the existing regime-aware strategy engines. The monitor API computes and briefly caches the result from stored candles. The web dashboard renders a dedicated portfolio view and keeps the existing symbol views unchanged.

**Tech Stack:** TypeScript, Bun, bun:test, Bun SQLite, Next.js, React, lightweight-charts.

---

### Task 1: Portfolio Sizing and Shared-Capital Engine

**Files:**
- Create: `packages/core/portfolio.ts`
- Modify: `packages/core/strategy.ts`
- Modify: `packages/core/core.test.ts`

- [x] Write failing tests for 2% stop-risk sizing, 5x leverage, 25% position margin cap, 100% total margin cap, partial sizing, signal priority, isolated liquidation, and common-start selection.
- [x] Run `bun test packages/core/core.test.ts` and confirm the portfolio tests fail because the API does not exist.
- [x] Generate scored candidate trades from the existing per-symbol strategy backtests.
- [x] Implement the chronological portfolio simulator and result types.
- [x] Run `bun test packages/core/core.test.ts` and confirm all tests pass.

### Task 2: Authoritative Portfolio API

**Files:**
- Modify: `packages/monitor/api.ts`
- Modify: `packages/monitor/store.ts`
- Modify: `config.ts`
- Modify: `packages/web/lib/api.ts`

- [x] Add portfolio configuration defaults for starting capital, leverage, risk, and margin caps.
- [x] Build the required candle sets for all configured symbols from the store.
- [x] Add a cached `GET /api/portfolio` response using the core simulator.
- [x] Add matching web API result types and `getPortfolio()` client.
- [x] Run `bun run check`.

### Task 3: Portfolio-First Dashboard

**Files:**
- Create: `packages/web/components/PortfolioChart.tsx`
- Create: `packages/web/components/PortfolioView.tsx`
- Modify: `packages/web/app/page.tsx`

- [x] Add a Portfolio tab before symbol tabs.
- [x] Render the approved portfolio-first equity header and curve.
- [x] Render the compact allocation board, risk summary, rejected signals, and attribution.
- [x] Preserve the existing symbol chart and backtest views.
- [x] Verify responsive layout without horizontal page overflow.
- [x] Run `bun run check` and `cd packages/web && bun run build`.

### Task 4: End-to-End Verification and Publish

**Files:**
- Modify: `docs/superpowers/plans/2026-06-06-portfolio-simulator.md`

- [x] Restart the monitor and dashboard.
- [x] Verify `GET /api/portfolio` and reconcile the displayed final equity with the API response.
- [x] Verify desktop and mobile portfolio views in the in-app browser.
- [x] Run fresh tests, production build, and `git diff --check`.
- [ ] Commit, push the current branch, and confirm PR #1 contains the new commit.
