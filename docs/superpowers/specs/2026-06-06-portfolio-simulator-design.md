# Shared-Capital Portfolio Simulator Design

## Objective

Add a portfolio-first view that shows the actual chronological evolution of one shared account across every configured symbol. This replaces misleading sums of independent symbol backtests with a simulation where signals compete for the same capital.

## Approved Capital Model

- Starting equity: `$1,000`.
- Leverage: `5x`.
- Margin mode: isolated per position.
- Target risk: `2%` of current portfolio equity if the stop fills, including expected fees and slippage.
- Maximum margin per position: `25%` of current equity.
- Maximum total posted margin: `100%` of current equity.
- Remaining capacity may partially size the next eligible trade.
- Simultaneous entries are prioritized by highest signal score, then earliest signal time, then symbol.
- One active position per symbol.
- If isolated margin is exhausted before the strategy stop, close the position as a liquidation with configured fees and slippage.

## Common Simulation Window

The portfolio begins at the earliest timestamp where every configured symbol has:

- 15-minute strategy candles;
- enough closed 1-hour candles for a ready regime classification;
- completed daily history for range and swing levels.

No symbol joins after the portfolio start. This gives each configured market the same opportunity window.

## Chronological Simulation

The core portfolio simulator owns one regime-aware strategy engine per symbol and processes a merged 15-minute timeline.

At each timestamp:

1. Mark all open positions to the current candle close.
2. Process liquidations, stops, and targets; release margin and realize P&L.
3. Collect new entry signals from all symbols.
4. Sort entries by score, signal time, and symbol.
5. Size and accept entries against current equity and available margin.
6. Record rejected signals when no margin remains.
7. Record an equity point with equity, realized balance, used margin, gross notional, and drawdown.

Fees and slippage use the existing configured defaults.

## Portfolio Result

The result exposes:

- starting, final, peak, and minimum equity;
- total return, maximum drawdown, profit factor, fees, and liquidation count;
- equity and exposure timeline;
- active positions with current P&L and allocation percentage;
- closed portfolio trades;
- accepted, partially sized, and rejected signals;
- per-symbol and per-strategy attribution.

## API

The monitor API adds `GET /api/portfolio`.

It reads the cached candles for every configured symbol, runs the authoritative portfolio simulation, and caches the response briefly so the dashboard does not recalculate it on every poll.

## Dashboard

Add a `Portfolio` tab before the symbol tabs.

The approved layout combines:

- portfolio-first ordering from layout A;
- compact allocation-board styling from layout B.

The view contains:

1. Portfolio equity and headline risk metrics.
2. Equity curve with margin and gross-exposure context.
3. Allocation board for open positions, current entries, and rejected signals.
4. Portfolio risk summary.
5. Closed-trade and attribution summaries.

The existing symbol chart and symbol backtest remain available under each symbol tab.

## Validation

- Unit tests prove risk sizing, margin caps, priority ordering, partial sizing, shared-capital competition, liquidation handling, and common-window selection.
- Portfolio output is verified against the cached configured symbols.
- Desktop and mobile layouts are verified in the running dashboard.
- Results are historical simulation only and do not imply future profitability.
