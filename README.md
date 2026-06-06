# Hyperliquid Level Monitor

A self-hosted monitor for **Hyperliquid perpetuals** that automatically marks the key price levels on a chart, watches live 15-minute candles, and alerts you the moment price touches a level — via Telegram and a read-only web dashboard.

It is a **monitoring and alerting tool, not a trading bot.** It places no orders, holds no account keys, and never executes. It tells you when something worth looking at happens and shows you a chart so you can verify it yourself.

---

## What it does

- **Auto-marks four levels** per coin, recomputed each UTC day from the daily candle series:
  - **Range High / Range Low** — the prior completed day's high and low.
  - **Swing High / Swing Low** — the nearest pivot (fractal) high above the range high and pivot low below the range low, scanning back through all available history.
- **Watches live 15m candles** over a Hyperliquid WebSocket and runs detection only on *closed* candles (never the still-forming one).
- **Touch & break detection** — fires a `LEVEL_TOUCH` when price tags a level and rejects, a `LEVEL_BREAK` when a level gives way. Duplicate touches on the same level are suppressed within a cooldown window.
- **Regime-aware signals** (informational only) — strict range reversion in quiet ranges and directional breakout momentum in trends. Every signal includes a direction, entry, stop, target, strategy, regime, and score.
- **Backtesting and shared-portfolio simulation** — independent token evidence plus a shared-capital portfolio view with allocation, equity history, risk metrics, attribution, and complete executed-trade ledgers.
- **Telegram alerts** — a message lands within one closed candle of price touching a level.
- **Web dashboard** — a candlestick chart with the four level lines drawn as labelled horizontal lines, event markers, and a live signal feed. This is your verification tool: it makes it obvious at a glance whether the auto-marked levels sit where they should.
- **Multi-coin** — monitors a configurable list of perps at once (e.g. `BTC, ETH, SOL, HYPE, …`), including HIP-3 builder-deployed markets via the `dex:ASSET` form (e.g. `xyz:SP500`).
- **Local SQLite cache** — candles, levels, and events are stored on disk, so the dashboard loads instantly and the engine can recompute without re-hitting the API.

---

## Strategy and portfolio model

The monitor evaluates signals on completed **15-minute candles**. It classifies market direction from already-closed **1-hour candles** and derives price levels from completed **daily candles**. Chart-only intervals also include `4h`.

### Market direction

The 1-hour regime classifier uses ADX 14, EMA 20, EMA 50, and the EMA 50 slope over 10 candles:

- **Uptrend:** ADX is at least 22, EMA 20 is above EMA 50, and EMA 50 is rising.
- **Downtrend:** ADX is at least 22, EMA 20 is below EMA 50, and EMA 50 is falling.
- **Range:** warmup is incomplete, ADX is below 22, or the EMA direction and slow-EMA slope do not agree.

Only an already-closed 1-hour candle is used, so a 15-minute signal never looks ahead into a forming regime candle.

### Range reversion

Range reversion is allowed only when the classified regime is `RANGE`, ADX is at most 12, and the signal score is at least 80.

1. A completed 15-minute candle touches and rejects range high, range low, swing high, or swing low within the 0.08% tolerance.
2. Within three candles, support requires a bullish confirmation candle whose low does not undercut the touch candle; resistance requires the inverse bearish confirmation.
3. A long triggers when price breaks the confirmation high. A short triggers when price breaks the confirmation low.
4. The stop sits beyond the touch/confirmation extreme with a 0.05% buffer.
5. The natural target is the opposite range or swing level, capped at 2R.

The score starts at 40 and adds 20 each for a swing-level touch, a confirmation body larger than the recent 10-candle average, and at least 2:1 reward-to-risk.

### Trend momentum

Trend momentum is active only in `UPTREND` or `DOWNTREND`.

- An uptrend candidate requires a close above the previous 40-candle high and RSI 14 of at least 60.
- A downtrend candidate requires a close below the previous 40-candle low and RSI 14 of at most 40.
- Entry occurs at the next candle open if the regime still agrees.
- Stop distance is `2.5 × ATR 14`.
- Target distance is `2.5R`.
- Trend signals receive a score of 80.

The engine permits **one active strategy trade per symbol**. If both stop and target are touched inside the same candle, the simulator resolves the stop first, which is intentionally conservative.

### Friction and token backtests

Backtests apply 0.035% fee and 0.015% slippage per side. Each token view runs the strategy independently from the first available strategy candle and reports R-based evidence, strategy/regime breakdowns, a chronological first-70%/last-30% split, and trade-sequence Sharpe and Sortino ratios.

Independent token results answer, “How did this strategy behave on this market?” They are not a funded account and do not include competition for shared portfolio margin.

### Shared-capital allocation

The portfolio simulator starts at the first timestamp where every configured token has enough 15-minute, 1-hour, and daily history. Defaults:

| Rule | Default |
|---|---:|
| Starting capital | `$1,000` |
| Leverage | `5x` isolated |
| Target risk at stop | `2%` of current equity |
| Maximum posted margin per position | `25%` of current equity |
| Maximum total posted margin | `100%` of current equity |
| Competing simultaneous signals | Highest score first |
| Remaining margin below desired size | Partial allocation |
| Already-active symbol | Reject new signal |

Position size first targets the 2% stop-risk budget, then applies the per-position and total-margin caps. **Allocated capital** in the dashboard means posted isolated margin; **notional** is the leveraged market exposure. Each position can liquidate independently if its isolated margin is exhausted.

The portfolio result is the authoritative source for executed capital, P&L, and exit reason. Token pages show this same executed ledger filtered to that token, so their allocated capital and P&L reconcile exactly with the portfolio.

### Performance metrics and ledgers

- **Profit factor:** gross winning P&L divided by absolute gross losing P&L.
- **Maximum drawdown:** largest peak-to-trough decline in the mark-to-market portfolio equity curve.
- **Portfolio Sharpe:** average UTC daily equity return divided by sample volatility, annualized with `sqrt(365)` and a 0% risk-free rate.
- **Portfolio Sortino:** average UTC daily equity return divided by downside deviation, annualized with `sqrt(365)` and a 0% minimum acceptable return.
- **Trade Sharpe / Sortino:** the same risk-adjusted concepts applied to the independent token backtest's net trade-return sequence, without calendar annualization.

The portfolio ledger and token-filtered ledgers show every executed closed trade with entry and exit time/price, direction, strategy, regime, posted margin, leveraged notional, USD P&L, return on margin, and exit type (`TARGET`, `STOP`, or `LIQUIDATION`).

These metrics and ledgers are reporting only. They do not change signals, entries, exits, sizing, allocation priority, or performance.

---

## Architecture

Two processes that share only a SQLite file:

```
Hyperliquid API ──WS live candles──▶  Bun monitor service
                ──REST history────▶   - computes levels
                                       - detects touches / signals
                                       - writes to SQLite
                                       - sends Telegram alerts
                                       - serves a JSON API (HTTP)
                                               │
                                          SQLite file
                                               │
                                       Next.js dashboard (reads the JSON API)
                                       - candlestick chart + level lines
                                       - signal feed
```

The **monitor** is the brain and runs 24/7. The **dashboard** is a read-only window onto it.

The strategy logic lives in `packages/core` and is **pure** — no network, no I/O. It takes candles in and returns plain objects, which keeps it unit-tested and reusable.

```
packages/
├── core/        # pure strategy logic (levels, detection, scoring) + tests
├── monitor/     # Bun service: Hyperliquid client, SQLite store, HTTP API, Telegram
└── web/         # Next.js + Tailwind + lightweight-charts dashboard
config.ts        # single source of configuration
data/            # SQLite database (gitignored)
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript end to end |
| Monitor runtime | [Bun](https://bun.sh) (WebSocket + detection + storage + HTTP API) |
| Storage | SQLite via `bun:sqlite` |
| Frontend | Next.js + Tailwind CSS |
| Charting | [lightweight-charts](https://github.com/tradingview/lightweight-charts) (TradingView, MIT) |
| Notifications | Telegram Bot API |
| Market data | Hyperliquid public REST + WebSocket |

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) installed.

### Install

```bash
bun install
```

### Run the monitor (the brain)

```bash
bun run monitor
```

It backfills recent candle history, prints each coin's four levels, opens the WebSocket, and starts the JSON API on `http://localhost:8787`.

### Run the dashboard

In a second terminal:

```bash
bun run web
```

Open `http://localhost:3000`.

### Run the tests

```bash
bun test            # core strategy unit tests
bun run check       # tests + TypeScript type-check
```

---

## Configuration

All configuration lives in [`config.ts`](config.ts). Key options:

| Option | Default | Meaning |
|---|---|---|
| `coins` | `BTC, ETH, SOL, …` | Perps to monitor. Override with the `COINS` env var, e.g. `COINS="ETH,SOL,xyz:SP500"`. |
| `candleInterval` | `15m` | The detection interval. |
| `regimeInterval` | `1h` | Closed-candle market-direction interval. |
| `swingLookbackDays` | `0` | `0` = scan all available history for swing levels (no cap). |
| `pivotWindow` | `2` | Fractal pivot window for swing detection. |
| `touchTolerance` | `0.0008` | How close (0.08%) counts as a touch. |
| `touchCooldownMinutes` | `60` | Suppress duplicate touch alerts within this window. |
| `confirmWithinCandles` | `3` | Candles allowed for a reversion sequence to confirm. |
| `regime` | ADX 14 / EMA 20 / EMA 50 | Directionality classifier settings. |
| `trend` | 40-candle breakout / 2.5 ATR stop / 2.5R target | Momentum strategy settings. |
| `range` | ADX ≤ 12 / score ≥ 80 / 2R cap | Strict range-reversion filter. |
| `backtest` | 0.035% fee + 0.015% slippage per side | Simulated trading friction. |
| `portfolio` | `$1,000`, 5x, 2% risk, 25% position margin, 100% total margin | Shared-capital simulation settings. |
| `staleSocketSeconds` | `90` | Force a WebSocket reconnect after this much silence. |
| `apiPort` | `8787` | Monitor JSON API port. |
| `dbPath` | `data/monitor.db` | SQLite file location. |

### Telegram alerts (optional)

Set these as environment variables before starting the monitor:

```bash
export TG_BOT_TOKEN="your-bot-token"
export TG_CHAT_ID="your-chat-id"
```

Leave them unset to run dashboard-only with no Telegram delivery.

---

## API endpoints

The monitor serves read-only JSON on `config.apiPort` (default `8787`):

| Endpoint | Returns |
|---|---|
| `GET /api/coins` | List of monitored coins. |
| `GET /api/levels?coin=…` | Today's four levels for a coin. |
| `GET /api/candles?coin=…&limit=…` | Recent candles for the chart. |
| `GET /api/events?coin=…&limit=…` | Recent touches, breaks, and signals (newest first). |
| `GET /api/status?coin=…` | Coin, last candle time, socket health, current price. |
| `GET /api/portfolio` | Shared-capital summary, equity timeline, active allocations, complete closed-trade ledger, decisions, and attribution. |

---

## Scope

**In scope:** auto level marking, live monitoring, touch/break detection, regime-aware informational signals, independent token backtests, shared-capital portfolio simulation, complete trade ledgers, a verification dashboard, and Telegram alerts across multiple perps.

**Out of scope:** order placement and any authenticated/trading endpoints, spot markets, funding-rate modeling, borrowing costs, and guarantees of live profitability.

---

## Disclaimer

This software is for informational and educational purposes only. It is not financial advice and it does not place trades. Markets are risky; verify everything yourself before acting on any signal. Use at your own risk.
