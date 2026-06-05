```
██████╗  █████╗ ███╗   ██╗ ██████╗ ███████╗██████╗  ██████╗ ███████╗███████╗
██╔══██╗██╔══██╗████╗  ██║██╔════╝ ██╔════╝██╔══██╗██╔═══██╗██╔════╝██╔════╝
██████╔╝███████║██╔██╗ ██║██║  ███╗█████╗  ██████╔╝██║   ██║███████╗███████╗
██╔══██╗██╔══██║██║╚██╗██║██║   ██║██╔══╝  ██╔══██╗██║   ██║╚════██║╚════██║
██║  ██║██║  ██║██║ ╚████║╚██████╔╝███████╗██████╔╝╚██████╔╝███████║███████║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚═════╝  ╚═════╝ ╚══════╝╚══════╝
        t r e n d - a w a r e   l e v e l   m o n i t o r   ·   H Y P E R L I Q U I D
```

# RangeBoss

A self-hosted, **trend-aware level monitor for Hyperliquid perpetuals**. It auto-marks each coin's key price levels, works out whether the market is trending or ranging, watches live candles, and alerts you when price interacts with a level — via Telegram and a read-only web dashboard.

It is a **monitoring and alerting tool, not a trading bot.** It places no orders, holds no account keys, and never executes. It surfaces what's worth looking at and shows you a chart so you can verify it yourself.

---

## The levels it marks

Per coin, recomputed each UTC day from the daily candle series:

- **Range High / Range Low** — the prior completed day's high and low (your immediate intraday box).
- **Swing High / Swing Low** — the **most recent _major_ swing pivot** high and low. These are the recent structure price actually retests (recent lower-highs in a downtrend, higher-lows in an uptrend), not far-away counter-trend levels. Pivot significance is controlled by `pivotWindow`.
- **Trend** — `UP` / `DOWN` / `SIDE`, derived from market structure: higher-highs **and** higher-lows = `UP`; lower-highs **and** lower-lows = `DOWN`; anything mixed = `SIDE`.

The "day" boundary is **00:00 UTC**; everything is computed in UTC and only converted to local time for display.

---

## How it detects signals (trend-aware)

This is the heart of RangeBoss, and it is **gated by the trend** so the engine trades *with* the market, not against it.

- **Touch & break** (informational, fire in any regime):
  - `LEVEL_TOUCH` — price tags a level and rejects (closes back on the right side).
  - `LEVEL_BREAK` — price closes through a level (it gave way).
  - Duplicates on the same level are suppressed within a cooldown window.
- **Confirmed reversion signals** — a three-candle sequence (touch → hold → trigger) that produces a direction, entry, stop, target, and a 0–100 confluence score. These are **only emitted with the trend:**
  - **`UP` trend → LONG signals only** (buy support).
  - **`DOWN` trend → SHORT signals only** (sell resistance).
  - **`SIDE` → both** (full mean-reversion — the regime this setup is built for).

So RangeBoss no longer fades support in a downtrend or resistance in an uptrend. Touches and breaks still show for situational awareness; only the actionable confirmed signal is trend-filtered. **All signals are informational — surfaced, never traded.**

---

## The dashboard

- **Multi-timeframe candlestick chart** — switch between 15m / 1h / 4h / 1d.
- **Level lines + trend badge** — the four levels drawn as labelled horizontal lines, plus an `UP` / `DOWN` / `SIDE` badge for the selected coin.
- **History overlay toggle** — draws every past day's levels as per-day stepped lines across the loaded range, so you can see how the levels moved over time. (Today's full-width lines hide while history is on.)
- **Signal feed** — recent touches, breaks, and confirmed signals (with the trend each one fired under).
- **Themes** — Light / Dusk / Dark.
- **Multi-coin selector** — flick between all monitored perps.

It's your verification tool: it makes it obvious at a glance whether the auto-marked levels and trend read sit where they should.

---

## Other capabilities

- **Multi-coin** — monitors a configurable list of perps at once, including HIP-3 builder-deployed markets via the `dex:ASSET` form (e.g. `xyz:SP500`, `xyz:XYZ100`).
- **Live data** — a Hyperliquid WebSocket feeds live candles; detection runs only on *closed* candles, never the still-forming one. Auto-reconnect with a staleness watchdog guards against a silently dead socket.
- **Local SQLite cache** — candles, levels, and events are stored on disk, so the dashboard loads instantly and the engine can recompute without re-hitting the API.
- **Telegram alerts** — a message lands within one closed candle of a level touch or a confirmed signal (with trend context).

---

## Architecture

Two processes that share only a SQLite file:

```
Hyperliquid API ──WS live candles──▶  Bun monitor service
                ──REST history────▶   - computes levels + trend
                                       - detects touches / trend-gated signals
                                       - writes to SQLite
                                       - sends Telegram alerts
                                       - serves a JSON API (HTTP)
                                               │
                                          SQLite file
                                               │
                                       Next.js dashboard (reads the JSON API)
                                       - multi-timeframe chart + levels + trend
                                       - history overlay + signal feed
```

The **monitor** is the brain and runs 24/7. The **dashboard** is a read-only window onto it.

The strategy logic lives in `packages/core` and is **pure** — no network, no I/O. It takes candles in and returns plain objects (levels, trend, events), which keeps it unit-tested and reusable.

```
packages/
├── core/        # pure strategy logic: levels, trend, detection, scoring (+ tests)
├── monitor/     # Bun service: Hyperliquid client, SQLite store, HTTP API, Telegram
└── web/         # Next.js + Tailwind + lightweight-charts dashboard
config.ts        # single source of configuration
data/            # SQLite database (gitignored)
PLAN.md          # the versioned build spec (v1 → v4)
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
It backfills recent candle history, prints each coin's levels and trend, opens the WebSocket, and starts the JSON API on `http://localhost:8787`.

### Run the dashboard
In a second terminal:
```bash
bun run web
```
Open `http://localhost:3000`. (`bun run web` auto-clears any stale dev server and the build cache, then starts pinned to port 3000.)

### Tests
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
| `candleInterval` | `15m` | The detection interval (signals always run on 15m, regardless of the chart timeframe). |
| `chartIntervals` | `15m, 1h, 4h, 1d` | Timeframes available in the dashboard chart. |
| `swingLookbackDays` | `0` | `0` = scan all available history for swing pivots (no cap). |
| `pivotWindow` | `5` | Fractal pivot window — higher = only major swing turning points feed the swings and the trend. |
| `trendMethod` | `structure` | Trend detection method (market structure). |
| `touchTolerance` | `0.0008` | How close (0.08%) counts as a touch. |
| `touchCooldownMinutes` | `60` | Suppress duplicate touch/break alerts within this window. |
| `confirmWithinCandles` | `3` | Candles allowed for a reversion sequence to confirm. |
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
| `GET /api/intervals` | Available chart timeframes. |
| `GET /api/levels?coin=…` | Today's levels **and trend** for a coin. |
| `GET /api/levels/history?coin=…&from=…&to=…` | Per-day historical levels for the history overlay. |
| `GET /api/candles?coin=…&interval=…&limit=…` | Recent candles for the chart. |
| `GET /api/events?coin=…&limit=…` | Recent touches, breaks, and signals (newest first). |
| `GET /api/status?coin=…` | Coin, last candle time, socket health, current price. |

---

## Scope

**In scope:** auto level marking, trend detection, live monitoring, touch/break detection, trend-gated reversion signals, a multi-timeframe verification dashboard with a history overlay, and Telegram alerts across multiple perps.

**Out of scope:** order placement and any authenticated/trading endpoints, and spot markets. The core engine is pure, so a backtester can be (and is being) built on top of it without touching the live logic.

---

## Disclaimer

This software is for informational and educational purposes only. It is not financial advice and it does not place trades. Markets are risky; verify everything yourself before acting on any signal. Use at your own risk.
