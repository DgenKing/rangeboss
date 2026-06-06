# Regime-Aware Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## File Structure

- Create `packages/core/indicators.ts`: deterministic EMA, ATR, RSI, ADX, and regime classification.
- Create `packages/core/strategy.ts`: shared one-position regime-aware live/backtest signal engine.
- Modify `packages/core/types.ts`: add strategy/regime metadata.
- Modify `packages/core/backtest.ts`: use the shared engine and calculate realistic analytics.
- Modify `packages/core/core.test.ts`: cover indicators, regimes, one-position behavior, range gating, and trend signals.
- Modify `packages/monitor/index.ts`: use the shared engine for live confirmed signals.
- Modify `packages/web/app/page.tsx`: show regime, strategy split, risk analytics, and comparison metrics.
- Modify `packages/web/lib/api.ts`: align event types with core metadata.
- Modify `config.ts`: centralize regime, momentum, and friction defaults.

### Task 1: Indicators and Regime Classification

- [ ] Write failing tests for EMA direction, ADX threshold behavior, RSI, ATR, and no-future-candle regime lookup.
- [ ] Run `bun test packages/core/core.test.ts` and confirm the new tests fail.
- [x] Implement `packages/core/indicators.ts`.
- [x] Run `bun test packages/core/core.test.ts` and confirm the tests pass.

### Task 2: Shared Regime-Aware Signal Engine

- [ ] Write failing tests proving range signals are suppressed in trends, trend breakouts are directional, and one active trade blocks overlapping signals.
- [ ] Run `bun test packages/core/core.test.ts` and confirm the new tests fail.
- [x] Implement `packages/core/strategy.ts` and extend core event metadata.
- [x] Run `bun test packages/core/core.test.ts` and confirm the tests pass.

### Task 3: Realistic Backtest Analytics

- [ ] Write failing tests for stop-first exits, friction, profit factor, maximum drawdown, exposure, regime splits, buy-and-hold, and chronological split reporting.
- [ ] Run `bun test packages/core/core.test.ts` and confirm the new tests fail.
- [x] Refactor `packages/core/backtest.ts` to use the shared strategy engine and calculate the new analytics.
- [x] Run `bun test packages/core/core.test.ts` and confirm the tests pass.

### Task 4: Live Monitor Integration

- [x] Modify `packages/monitor/index.ts` to derive regimes from closed 1h candles and use one shared engine per symbol.
- [x] Preserve existing level touch/break event recording while replacing confirmed-signal generation with the regime-aware engine.
- [x] Run `bun run check`.

### Task 5: Dashboard Reporting

- [x] Update web event types and the backtest options in `packages/web/lib/api.ts` and `packages/web/app/page.tsx`.
- [x] Show current regime and momentum indicators.
- [x] Show range/uptrend/downtrend analytics, friction, drawdown, profit factor, exposure, buy-and-hold, and out-of-sample results.
- [x] Run `bun run check` and `bun run build` from `packages/web`.

### Task 6: End-to-End Verification and Publish

- [x] Restart the monitor and dashboard.
- [x] Verify live API and dashboard rendering.
- [x] Re-run the all-symbol portfolio comparison.
- [ ] Commit, push the existing branch, and update draft PR #1.
