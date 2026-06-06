# Regime-Aware Strategy Design

## Objective

Replace the current always-on mean-reversion policy with a regime-aware strategy that:

- classifies each symbol as `UPTREND`, `DOWNTREND`, or `RANGE` from closed 1h candles;
- runs range rejection signals only during `RANGE`;
- runs directional momentum breakouts only during matching trends;
- permits at most one active trade per symbol across all strategies;
- uses identical signal logic in live monitoring and backtesting.

## Regime Classification

Calculate indicators from closed 1h candles:

- EMA(20)
- EMA(50)
- ADX(14)
- RSI(14)
- ATR(14)

Classification:

- `UPTREND`: ADX >= 22, EMA(20) > EMA(50), and EMA(50) > EMA(50) ten candles ago.
- `DOWNTREND`: ADX >= 22, EMA(20) < EMA(50), and EMA(50) < EMA(50) ten candles ago.
- `RANGE`: otherwise.

Each 15m decision must use only the latest already-closed 1h candle.

## Signal Policies

### Range Reversion

- Enabled only in `RANGE`.
- Requires ADX(14) <= 12 and signal score >= 80.
- Retains the existing daily range/swing touch, confirmation, entry, and stop rules.
- Caps the target at 2R instead of requiring a full move to the opposite level.
- Existing touch/break events may still be recorded, but confirmed range trades are suppressed outside `RANGE`.

### Trend Momentum

- Enabled only in `UPTREND` or `DOWNTREND`.
- `UPTREND`: closed 15m candle closes above the prior 40-candle high and RSI(14) >= 60.
- `DOWNTREND`: closed 15m candle closes below the prior 40-candle low and RSI(14) <= 40.
- Entry occurs at the next 15m candle open.
- Stop distance is 2.5 * ATR(14).
- Target distance is 2.5R.

## Position Constraint

Only one active trade is allowed per symbol. While a trade is active:

- ignore all new range and trend entries;
- close at stop or target;
- if both stop and target occur in one candle, count stop first;
- allow the next new setup only after the active trade exits.

## Backtest Reporting

The backtest must report:

- total, range, uptrend, and downtrend results;
- win rate, net R, average R, profit factor, maximum drawdown, exposure, and fees/slippage;
- recent trades including strategy and regime;
- buy-and-hold comparison;
- chronological in-sample/out-of-sample split.

Default friction:

- fee: 3.5 basis points per side;
- slippage: 1.5 basis points per side.

## Live Monitoring

The monitor uses the same core engine and emits confirmed signals with strategy and regime metadata. It maintains one active trade state per symbol for the running process.
