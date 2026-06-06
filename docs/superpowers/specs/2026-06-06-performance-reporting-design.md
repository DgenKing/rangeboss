# Performance Reporting Design

## Goal

Add risk-adjusted performance metrics, complete executed-trade ledgers, and full strategy documentation without changing any strategy signal, trade, sizing, allocation, friction, liquidation, or portfolio performance result.

## Reporting Model

- Portfolio Sharpe and Sortino use UTC daily mark-to-market equity returns from the existing portfolio timeline, a zero risk-free rate, and `sqrt(365)` annualization.
- Token strategy backtests show trade-sequence Sharpe and Sortino from the existing net `returnPct` values. They are explicitly labeled as trade metrics and are not a funded-account simulation.
- The shared portfolio closed-trade ledger is authoritative for allocated margin, leveraged notional, USD P&L, return on margin, and exit reason.
- The portfolio view shows every executed closed trade.
- Each token view shows the same executed portfolio ledger filtered to that token, so its capital and P&L reconcile with the portfolio.

## Trade Ledger Fields

Each completed trade shows token, direction, strategy, regime, entry time and price, exit time and price, posted isolated margin, leveraged notional, USD P&L, return on margin, and exit reason (`TARGET`, `STOP`, or `LIQUIDATION`).

## Performance Invariance

The implementation may derive and expose additional values only. Existing strategy and portfolio outputs must remain unchanged. Tests will protect final equity, total return, drawdown, trade count, trade allocation, and trade P&L.

## Documentation

The README will explain timeframes, regime classification, both strategy paths, exits, friction, one-active-trade behavior, shared-capital allocation, isolated leverage, performance metrics, API surfaces, and the distinction between independent token evidence and portfolio execution.
