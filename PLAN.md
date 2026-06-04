# PLAN.md — Hyperliquid Level Monitor

**A single-coin chart monitor for Hyperliquid perpetuals.** It automatically marks the key price levels, watches live 15-minute candles, notifies the user when price touches a level, and renders a chart so the user can verify how the levels were drawn.

This document is the complete build spec. Implement it as written. Where it says "verify against docs," do that before coding that piece — do not assume API field names from memory.

---

## 1. Goal (what success looks like)

1. The app monitors **one** Hyperliquid perpetual (default **ETH**, switchable to **SOL** via config). **Never Bitcoin.**
2. It **automatically marks four levels** on the chart: prior-day high, prior-day low, next swing high, next swing low.
3. When live price **touches** one of those levels, the user gets a **notification** (Telegram + in-dashboard).
4. The user can open a **dashboard with a rendered candlestick chart** showing the candles, the four level lines, and any signals, so they can confirm the marking is correct.

That is the whole of v1. **It does NOT place orders.** No trading, no account keys, no execution. Monitoring and alerting only. Execution is explicitly out of scope.

---

## 2. Scope

**In scope (v1):**
- One configurable perp coin.
- Auto level marking (4 levels) recomputed daily.
- Live 15m candle monitoring via WebSocket.
- Touch detection + notification.
- A confirmed-reversion signal tier (entry/stop/target, informational only — surfaced, not traded).
- A read-only dashboard with a candlestick chart, level lines, and a signal feed.
- Telegram notifications.

**Out of scope (v1):**
- Order placement / any authenticated trading endpoints.
- Multiple coins at once.
- Spot markets — perps only.
- Backtesting (the engine is built pure so this can be added later, but don't build it now).
- Bitcoin.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | User requirement; one language end to end. |
| Backend / monitor | **Bun** | Long-running process holding the WebSocket; user already runs Bun. Single service does WS + detection + storage + HTTP API + Telegram. |
| Storage | **SQLite** via `bun:sqlite` | Zero-config, file-based, plenty for one coin. |
| Hyperliquid client | `nomeida/hyperliquid` TS SDK, OR a thin hand-rolled `fetch`/`WebSocket` client | SDK handles reconnects; hand-rolled is fine and removes a dependency. Pick one, see §6. |
| Frontend | **Next.js + Tailwind CSS** | Dashboard. Reads from the Bun API. |
| Charting | **lightweight-charts** (TradingView, MIT licence) | Candlestick series + horizontal price lines for the levels. This is the right tool — do not build a chart from scratch. |
| Notifications | **Telegram Bot API** | Fits the user's existing alerting stack. |

**Architecture:** two processes that share only the SQLite file.

```
Hyperliquid API ──WS 15m candles──▶  Bun monitor service
                 ──REST history──▶   - computes levels
                                      - detects touches/signals
                                      - writes to SQLite
                                      - sends Telegram alerts
                                      - serves JSON API (HTTP)
                                              │
                                         SQLite file
                                              │
                                      Next.js dashboard (reads JSON API)
                                      - candlestick chart + level lines
                                      - signal feed
```

The monitor is the brain and runs 24/7. The dashboard is a read-only window onto it.

---

## 4. Repo structure

```
hl-level-monitor/
├── PLAN.md                      # this file
├── config.ts                    # single source of config (see §11)
├── packages/
│   ├── core/                    # PURE strategy logic — NO network, NO I/O
│   │   ├── types.ts             # Candle, Levels, Signal, etc.
│   │   ├── levels.ts            # computeLevels()
│   │   ├── detect.ts            # detectTouch(), detectSignal()
│   │   └── core.test.ts         # unit tests against fixture candles
│   ├── monitor/                 # Bun service
│   │   ├── index.ts             # entrypoint: wires everything, starts WS + HTTP
│   │   ├── hyperliquid.ts       # API client (REST + WS) — see §6
│   │   ├── store.ts             # SQLite read/write
│   │   ├── telegram.ts          # alert sender
│   │   └── api.ts               # HTTP JSON endpoints for the dashboard
│   └── web/                     # Next.js + Tailwind dashboard
│       ├── app/page.tsx         # main dashboard page
│       ├── components/Chart.tsx # lightweight-charts wrapper
│       └── lib/api.ts           # fetch helpers hitting the monitor API
└── data/
    └── monitor.db               # SQLite file (gitignored)
```

**Critical rule:** `packages/core` imports nothing from `monitor` or `web` and does no network or file I/O. It takes candles in and returns plain objects. This is what makes it testable and reusable.

---

## 5. The strategy — exact definitions (read carefully)

This is the part where an implementer will otherwise improvise and get it wrong. Follow these definitions literally.

### 5.1 The "day" boundary

Crypto has no opening bell. Hyperliquid (like nearly all exchanges) closes its **daily candle at 00:00 UTC**. So:

- "**Yesterday**" = the most recently *completed* `1d` candle (the one whose close time `T` is the most recent 00:00 UTC that has already passed).
- The current (still-forming) daily candle is **today** and is **not** used for level marking.

The user is in the UK. 00:00 UTC = 01:00 their clock in summer (BST), 00:00 their clock in winter (GMT). The app works entirely in **UTC internally** and only converts to local time for display.

### 5.2 The four levels

Computed once per UTC day, at/after the 00:00 UTC rollover, from the **daily (`1d`) candle series**:

1. **rangeHigh** = high of yesterday's completed daily candle.
2. **rangeLow** = low of yesterday's completed daily candle.
3. **swingHigh** = the nearest **pivot high above `rangeHigh`**, scanning backwards through the daily series.
4. **swingLow** = the nearest **pivot low below `rangeLow`**, scanning backwards.

**Pivot definition (fractal, window k = 2):**
- Daily candle `i` is a **pivot high** if `high[i] >= high[i±j]` for all `j` in `1..k`.
- Daily candle `i` is a **pivot low** if `low[i] <= low[i±j]` for all `j` in `1..k`.

**Finding swingHigh:** walk daily candles from yesterday backwards (lookback = `config.swingLookbackDays`, default 90). Return the `high` of the first pivot high whose value is `> rangeHigh`. If none found in the lookback, set `swingHigh = null` and the dashboard shows "no swing high in range."
**swingLow** is the mirror: first pivot low with `low < rangeLow`.

So upper levels = `{ rangeHigh, swingHigh }` (resistance), lower levels = `{ rangeLow, swingLow }` (support).

### 5.3 Touch detection (fires the notification the user asked for)

Run on **every closed 15m candle** `c`. Use `config.touchTolerance` (default `0.0008` = 0.08%).

For each **upper** level `L`:
- **Touch (rejection):** `c.high >= L * (1 - tol)` **AND** `c.close <= L` → emit `LEVEL_TOUCH`, side `RESISTANCE`, level name.
- **Break:** `c.close > L * (1 + tol)` → emit `LEVEL_BREAK` (informational; means the level gave way).

For each **lower** level `L`:
- **Touch (rejection):** `c.low <= L * (1 + tol)` **AND** `c.close >= L` → emit `LEVEL_TOUCH`, side `SUPPORT`.
- **Break:** `c.close < L * (1 - tol)` → emit `LEVEL_BREAK`.

`LEVEL_TOUCH` is the primary notification. De-dupe: do not re-fire the same level+side more than once per `config.touchCooldownMinutes` (default 60).

### 5.4 Confirmed reversion signal (informational tier)

This is the distilled strategy (the "sneaky pivot" idea minus the opening-bell timing, which doesn't exist in 24/7 crypto). It is **surfaced on the dashboard and notified, but never auto-traded.** Three-candle sequence after a **support** touch (mirror for resistance):

- **Candle A** = the touch candle (tagged `SUPPORT`, closed back above the level).
- **Candle B** (next 15m) = **confirmation** if `B.close > B.open` (closed up) AND `B.low >= A.low` (held the low).
- **Candle C** (next) = **entry trigger** when its price crosses **above `B.high`**.
  - `direction = LONG`
  - `entry = B.high`
  - `stop = min(A.low, B.low) * (1 - config.stopBuffer)` (just beyond the structure; default buffer 0.0005)
  - `target = rangeHigh` if the touch was at `rangeLow`, else `swingHigh`
- Mirror all of the above for a **resistance** touch → `SHORT` (confirmation candle closes down and holds the high; entry on crossing below `B.low`; target the lower level).

Emit `CONFIRMED_SIGNAL` with direction, entry, stop, target, and a `score` (see 5.5). The sequence is invalidated if confirmation doesn't appear within `config.confirmWithinCandles` (default 3) candles of the touch.

### 5.5 Signal score (0–100)

A simple confluence score so weak and strong setups look different. Sum and clamp:
- +40 base for a valid confirmed sequence.
- +20 if the touched level is a `swing` level (stronger than a range level).
- +20 if confirmation candle B's body is `>` the average body of the last 10 candles (conviction).
- +20 if reward:risk `(|target-entry| / |entry-stop|) >= 2`.

Keep this in `core/detect.ts` as a pure function; it's the natural place to refine later.

---

## 6. Hyperliquid API reference

Base REST: `POST https://api.hyperliquid.xyz/info`, header `Content-Type: application/json`.
WebSocket: `wss://api.hyperliquid.xyz/ws`.
Docs (verify field names/shapes here before coding):
- Info endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- WS subscriptions: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions

Perps are referenced by **plain coin symbol** (`"ETH"`, `"SOL"`) on the raw API. (The `nomeida/hyperliquid` SDK uses `"ETH-PERP"` naming — match whichever client you choose.)

### 6.1 Historical candles (REST)

Request body:
```json
{ "type": "candleSnapshot",
  "req": { "coin": "ETH", "interval": "15m", "startTime": 1700000000000, "endTime": 1700100000000 } }
```
Only the most recent **5000 candles** per query are available — plenty for 15m and 1d here. Fetch both `15m` (for detection + chart) and `1d` (for levels).

**Expected candle shape (VERIFY against docs — field letters matter):**
```ts
interface RawCandle {
  t: number;  // open time, ms
  T: number;  // close time, ms
  s: string;  // symbol
  i: string;  // interval
  o: string;  // open  (string!)
  c: string;  // close (string!)
  h: string;  // high  (string!)
  l: string;  // low   (string!)
  v: string;  // volume
  n: number;  // trade count
}
```
Prices come as **strings** — parse to number on ingest. Normalise to a clean internal type immediately (see §7).

### 6.2 Live candles (WebSocket)

Subscribe:
```json
{ "method": "subscribe", "subscription": { "type": "candle", "coin": "ETH", "interval": "15m" } }
```
Updates arrive in the same candle shape and the **current candle updates repeatedly** until its period ends. **A candle is "closed"** when an update arrives whose `t` (open time) is greater than the previously tracked candle's `t`, OR when `now >= currentCandle.T`. Detection (§5.3/5.4) runs **only on closed candles**, never on the live-updating one.

Also subscribe to `allMids` (or read `c` of the live candle) for the current price shown on the dashboard.

**Reconnect:** the socket WILL drop. Implement: auto-reconnect with backoff, resubscribe on reconnect, and a heartbeat/staleness check — if no message for `config.staleSocketSeconds` (default 90), force a reconnect. A silently dead socket that looks alive is the main failure mode; guard against it explicitly.

---

## 7. Internal data types (`core/types.ts`)

```ts
export interface Candle {            // normalised, numbers not strings
  openTime: number;  closeTime: number;
  open: number; high: number; low: number; close: number;
  volume: number;
}

export interface Levels {
  coin: string;
  computedAt: number;                // ms, when these were marked
  forUtcDay: string;                 // e.g. "2026-06-02"
  rangeHigh: number; rangeLow: number;
  swingHigh: number | null; swingLow: number | null;
}

export type EventType = 'LEVEL_TOUCH' | 'LEVEL_BREAK' | 'CONFIRMED_SIGNAL';
export type Side = 'RESISTANCE' | 'SUPPORT';
export type Direction = 'LONG' | 'SHORT';

export interface MarketEvent {
  id?: number;
  type: EventType;
  coin: string;
  side: Side;
  levelName: 'rangeHigh' | 'rangeLow' | 'swingHigh' | 'swingLow';
  levelPrice: number;
  candleCloseTime: number;
  price: number;                     // close of the triggering candle
  // confirmed-signal-only fields:
  direction?: Direction;
  entry?: number; stop?: number; target?: number; score?: number;
  notified: boolean;
}
```

---

## 8. SQLite schema (`monitor/store.ts`)

```sql
CREATE TABLE IF NOT EXISTS candles (
  coin TEXT, openTime INTEGER, closeTime INTEGER,
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  PRIMARY KEY (coin, openTime)
);

CREATE TABLE IF NOT EXISTS levels (
  coin TEXT, forUtcDay TEXT, computedAt INTEGER,
  rangeHigh REAL, rangeLow REAL, swingHigh REAL, swingLow REAL,
  PRIMARY KEY (coin, forUtcDay)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT, coin TEXT, side TEXT, levelName TEXT, levelPrice REAL,
  candleCloseTime INTEGER, price REAL,
  direction TEXT, entry REAL, stop REAL, target REAL, score INTEGER,
  notified INTEGER DEFAULT 0,
  createdAt INTEGER
);
```
Store cached candles so the dashboard chart loads instantly and the engine can recompute without re-hitting the API.

---

## 9. Monitor service spec (`packages/monitor`)

`index.ts` startup sequence:
1. Load `config`.
2. Open SQLite, run migrations.
3. REST-fetch backfill: last ~300 `15m` candles and ~120 `1d` candles for the configured coin; store them.
4. `computeLevels()` for today; store; log them.
5. Open WS, subscribe to `15m` candle for the coin (+ `allMids`).
6. On each **closed** 15m candle: store it → run `detectTouch()` and the signal state machine → write any `MarketEvent`s → for each unnotified event, send Telegram and mark `notified`.
7. At each 00:00 UTC rollover (a timer, or detected when a new `1d` candle appears): recompute and store levels for the new day.
8. Run the HTTP API (`api.ts`) on `config.apiPort`.

`api.ts` — minimal read-only JSON endpoints for the dashboard:
- `GET /api/levels` → today's `Levels`.
- `GET /api/candles?limit=300` → recent normalised candles for the chart.
- `GET /api/events?limit=50` → recent `MarketEvent`s, newest first.
- `GET /api/status` → `{ coin, lastCandleTime, socketHealthy, currentPrice }`.

`telegram.ts` — `sendAlert(event)`. Message examples:
- Touch: `⚡ ETH touched rangeLow 2980.50 — price rejected and closed at 2987.10 (UTC 14:30)`
- Confirmed: `🟢 ETH LONG signal (score 80) — entry 2995, stop 2978, target 3050 (R:R 3.2)`
Bot token + chat id from config/env. Never log the token.

---

## 10. Dashboard spec (`packages/web`)

Next.js + Tailwind, read-only, polls the monitor API every ~5s.

**Layout:**
- **Header:** coin, current price, socket health dot (green/red), last-candle timestamp in both UTC and UK local time.
- **Chart (main panel):** `lightweight-charts` candlestick series of the recent 15m candles. Draw the four levels as **horizontal price lines** with labels and distinct colours:
  - rangeHigh — solid red, label "Range High"
  - swingHigh — dashed red, label "Swing High"
  - rangeLow — solid green, label "Range Low"
  - swingLow — dashed green, label "Swing Low"
  - Null swing levels are simply not drawn.
  - Mark fired events on the chart (e.g. a marker at the candle where a touch/signal occurred).
- **Signal feed (side panel):** list of recent `events` — type, side, level, price, time, and for confirmed signals the entry/stop/target/score and R:R.

The chart is the user's verification tool — its single most important job is to make it obvious, at a glance, whether the auto-marked lines sit where they should. Prioritise clarity of the level lines over decoration.

---

## 11. Config (`config.ts`)

```ts
export const config = {
  coin: 'ETH',                 // 'ETH' | 'SOL' — NEVER 'BTC'
  candleInterval: '15m',
  swingLookbackDays: 90,
  pivotWindow: 2,
  touchTolerance: 0.0008,      // 0.08%
  touchCooldownMinutes: 60,
  confirmWithinCandles: 3,
  stopBuffer: 0.0005,
  staleSocketSeconds: 90,
  apiPort: 8787,
  pollMs: 5000,
  telegram: {
    botToken: process.env.TG_BOT_TOKEN ?? '',
    chatId: process.env.TG_CHAT_ID ?? '',
  },
  restUrl: 'https://api.hyperliquid.xyz/info',
  wsUrl: 'wss://api.hyperliquid.xyz/ws',
};
```
Guard at startup: `if (config.coin === 'BTC') throw new Error('BTC is disabled by design');`

---

## 12. Build order (do it in this sequence)

**Phase 1 — `core` (pure, tested first).** Implement `types`, `computeLevels`, `detectTouch`, the signal state machine, and `scoreSignal`. Write `core.test.ts` with hand-built fixture candles covering: a clean support touch+reject, a break, a full confirmed long sequence, an invalidated sequence (no confirm in time), and a null-swing case. **All tests pass before moving on.** This is the cheapest place to be correct.

**Phase 2 — Hyperliquid client.** REST `candleSnapshot` (15m + 1d) and the WS candle subscription with reconnect + staleness guard. Verify candle field shapes against the live docs. Log a few candles and confirm parsing.

**Phase 3 — Monitor service.** Wire `core` + client + SQLite + the startup sequence in §9. Run it live and watch the logs: it should print today's four levels and emit a `LEVEL_TOUCH` log when price actually tags one.

**Phase 4 — Telegram.** Add `sendAlert`, fire on unnotified events. Confirm a real message lands.

**Phase 5 — Dashboard.** Next.js + Tailwind + lightweight-charts. Chart with level lines + signal feed, polling the API. This is where the user visually confirms the marking.

---

## 13. Acceptance criteria

- [ ] App monitors exactly one coin, ETH by default, SOL via config, and refuses to run on BTC.
- [ ] On startup it prints today's rangeHigh/Low and swingHigh/Low, computed off the 00:00-UTC daily boundary.
- [ ] Levels recompute automatically at the UTC day rollover.
- [ ] A Telegram message arrives within one closed 15m candle of price touching any level.
- [ ] Duplicate touch alerts for the same level are suppressed within the cooldown.
- [ ] The dashboard renders a candlestick chart with all four levels drawn as labelled horizontal lines, and they visibly sit at the correct prices.
- [ ] The signal feed lists touches and confirmed signals with their details.
- [ ] The WebSocket survives a forced disconnect and resubscribes automatically.
- [ ] `core` has unit tests and they pass; `core` contains no network or file I/O.
- [ ] No order-placement code exists anywhere.

---

## 14. Gotchas / verify-before-coding

- **Candle field names** (`t/T/o/h/l/c/v/n`) — confirm against the current Hyperliquid docs; do not trust them from memory.
- **Prices are strings** in API responses — parse on ingest, store as REAL.
- **Closed vs live candle** — only run detection on closed candles; the live one mutates.
- **UTC everywhere internally**; convert to UK local only for display.
- **Dead-but-open socket** is the main reliability risk — the staleness timer is not optional.
- **Coin naming** must match the chosen client (raw `"ETH"` vs SDK `"ETH-PERP"`).
- **lightweight-charts** is the chart lib — MIT licensed, candlestick + `createPriceLine` for levels. Don't hand-roll.

---
---

# PLAN.md v2 — Multi-Timeframe Charts & Extended History

**Status: spec for the next build. v1 above is shipped.** This section is additive — it changes the data/backfill/API/frontend layers so the chart is genuinely usable on the user's website. It does **not** touch the strategy engine (`core`), the level logic, or detection — those stay 15m-only and unchanged. Same rule as before: where it says "verify against docs," do that before coding that piece.

## v2.1 Goal

Make the chart usable for browsing real history across multiple timeframes, without tripping Hyperliquid's rate limit:

1. The chart can show **as much real history as Hyperliquid actually provides** per interval (the 5000-candle cap — ~52 days at 15m, ~208 days at 1h, ~2.3 yrs at 4h, ~13.7 yrs at 1d).
2. The user can **switch timeframes** (15m / 1h / 4h / 1d) in the dashboard.
3. All candles are **cached in SQLite once** and kept live via WebSocket, so normal operation makes near-zero REST calls.
4. Cold-start backfill is **throttled to stay under the weight limit** even across all configured coins.

**Out of scope (unchanged from v1):** no synthetic candles (never fabricate 15m from 1d — a daily OHLC has no intraday path; see the daily→15m reasoning), no order placement, no spot.

## v2.2 Root cause of "chart goes blank after ~2 days" (why this work is needed)

Three self-imposed caps, none of them Hyperliquid's limit:

1. **Backfill stores only 320 × 15m candles** — [packages/monitor/index.ts](packages/monitor/index.ts), `startTime: endTime - 320 * FIFTEEN_MS` ≈ 3.3 days. That's all that ever lands in SQLite for 15m.
2. **Frontend requests `limit=300`** — [packages/web/lib/api.ts](packages/web/lib/api.ts) ≈ 3.1 days.
3. **API hard-caps `limit` at 1000** — [packages/monitor/api.ts](packages/monitor/api.ts), `clampLimit(limit, 1, 1000)`, and ignores any `interval` param (hardwired to `config.candleInterval`).

**Already in place (leverage it):** the backfill *already* fetches and stores **5000 × 1d candles** (`store.saveCandles(coin, '1d', ...)`) but the chart never exposes them. The `candles` table is keyed `(coin, interval, openTime)` and `store.getRecentCandles(coin, interval, limit)` already takes an interval. So the data layer is multi-timeframe-ready; v1 just never wired the interval through the API or UI.

## v2.3 Scope of changes

| Layer | File | Change |
|---|---|---|
| Config | [config.ts](config.ts) | Add `chartIntervals`, per-interval backfill targets, weight-budget settings. |
| Backfill | [packages/monitor/index.ts](packages/monitor/index.ts) | Backfill every chart interval, incrementally (gap-fill), under a weight budget. |
| Store | [packages/monitor/store.ts](packages/monitor/store.ts) | Add candle-count helper; reuse existing interval-aware queries. |
| API | [packages/monitor/api.ts](packages/monitor/api.ts) | Accept + validate `interval`, raise `limit` clamp to 5000. |
| Live | [packages/monitor/hyperliquid.ts](packages/monitor/hyperliquid.ts) | Subscribe WS candle for each chart interval; store closed candles per interval. |
| Frontend | [packages/web/lib/api.ts](packages/web/lib/api.ts), [packages/web/app/page.tsx](packages/web/app/page.tsx), [packages/web/components/Chart.tsx](packages/web/components/Chart.tsx) | Timeframe switcher; interval-aware fetch; interval-aware marker offset. |

**Detection stays 15m-only.** `handleClosedCandle` runs `detectTouch` / the signal tracker **only for the `config.candleInterval` ('15m')** candle. Higher-timeframe closed candles are stored for charting and nothing else.

## v2.4 Config changes (`config.ts`)

```ts
// Intervals offered in the chart UI. '15m' MUST stay first / present —
// it is the detection interval. Order is the UI button order.
chartIntervals: ['15m', '1h', '4h', '1d'] as const,

// Max candles to backfill+serve per interval. Hyperliquid caps at 5000;
// keep 15m a bit lower if payloads feel heavy, but 5000 is fine.
backfillTarget: {
  '15m': 5000,   // ~52 days
  '1h':  5000,   // ~208 days
  '4h':  5000,   // ~2.3 years
  '1d':  5000,   // ~13.7 years
} as Record<string, number>,

// Cold-start throttle. Stay under Hyperliquid's 1200 weight/min/IP with headroom.
backfillWeightBudgetPerMin: 900,
backfillRequestSpacingMs: 300,   // floor spacing between REST calls
```

Keep `candleInterval: '15m'` as the **detection** interval (do not repurpose it). `chartIntervals` is purely for charting. Validate at startup that `candleInterval` is included in `chartIntervals`.

## v2.5 Backfill changes (`monitor/index.ts`) — throttled + incremental

Replace the fixed `320 × 15m` + `5000 × 1d` backfill with a per-interval loop that is **incremental** and **weight-aware**.

**Incremental rule (the cheap-restart win):** for each `(coin, interval)`, read `store.getLastCandleTime(coin, interval)`.
- **Cold (no rows):** fetch the full `backfillTarget[interval]` window (`startTime = now - target * intervalMs`).
- **Warm (rows exist):** fetch only the gap (`startTime = lastCandleTime - intervalMs`, small overlap to dedupe; `ON CONFLICT` upsert already handles overlap). This makes restarts trivially cheap.

**Throttle:** run all `(coin × interval)` fetches through a single shared limiter so the **sum of estimated weight stays under `backfillWeightBudgetPerMin`**, with at least `backfillRequestSpacingMs` between calls. A simple token-bucket (refill = budget/min) or a sequential queue with computed sleep both work. Estimate per-request weight as `~20 + ceil(candleCount / 60)` (see v2.10 — **verify the exact formula against the rate-limit docs before coding**).

**Keep levels working:** `computeLevels` still runs off the `1d` series (now backfilled by the same loop). The `scheduleUtcRolloverCheck` path stays; on rollover, recompute levels from the stored `1d` candles (the WS already keeps `1d` fresh — see v2.8 — so a REST refetch on rollover is optional, not required).

**Order of work at startup:** backfill `15m` for all coins first (it's what detection and the default chart need), then the higher intervals, so the dashboard is useful as early as possible while the rest streams in behind the budget.

## v2.6 Store changes (`monitor/store.ts`)

Mostly already there. Add one helper:

```ts
countCandles(coin: string, interval: string): number
// SELECT COUNT(*) FROM candles WHERE coin = ? AND interval = ?
```

Used by backfill to decide cold vs warm. `getRecentCandles(coin, interval, limit)` and `getLastCandleTime(coin, interval)` already exist and are interval-correct — reuse as-is. Schema needs no migration (`interval` is already part of the PK).

## v2.7 API changes (`monitor/api.ts`)

`GET /api/candles`:
- Accept `interval` query param; **validate against `config.chartIntervals`**, fall back to `config.candleInterval` if missing/invalid (never pass an unvalidated string through to the store).
- Raise the clamp: `clampLimit(limit, 1, 5000)`.
- Default `limit` to something generous but sane (e.g. `1500`) so the first paint shows real history.

```ts
if (url.pathname === '/api/candles') {
  const interval = resolveInterval(url);              // validated ∈ chartIntervals
  const limit = Number(url.searchParams.get('limit') ?? 1500);
  return json(store.getRecentCandles(resolveCoin(url), interval, clampLimit(limit, 1, 5000)));
}
```

Add `GET /api/intervals` → `config.chartIntervals` so the frontend renders the switcher from the source of truth (mirrors the existing `/api/coins`). Update the `apiIndex` HTML links to include `&interval=15m`.

## v2.8 Live updates per timeframe (`monitor/hyperliquid.ts` + `index.ts`)

Today the WS subscribes to **15m only**. To keep every chart timeframe live without REST polling, **subscribe one `candle` subscription per chart interval** (WS subscriptions are cheap and not on the REST weight budget; one coin × 4 intervals = 4 subs, all coins × 4 = well within the per-IP subscription cap — **verify the WS subscription cap in docs**).

- Generalise `HyperliquidSocket` to take `intervals: string[]` instead of a single `interval`, and subscribe each `(coin, interval)`.
- `onClosedCandle(coin, interval, candle)` gains the `interval` arg. In `handleClosedCandle`:
  - **Always** `store.saveCandles(coin, interval, [candle])`.
  - **Only when `interval === config.candleInterval`** run `detectTouch` + the signal tracker (unchanged logic).
- The `liveCandles` / `processed` maps must key on `coin + interval` (today they key on coin only — fix this or higher-TF candles will clobber the 15m close detection).

This means higher-TF candles close and persist in real time, so the chart stays current on every timeframe and steady-state REST usage is ~0.

## v2.9 Frontend changes (`packages/web`)

- **Fetch (`lib/api.ts`):** add `interval` to `getDashboardData(coin, interval)`; request `/api/candles?coin=…&interval=…&limit=1500` (or higher). `getCoins`-style `getIntervals()` helper hitting `/api/intervals`.
- **Page (`app/page.tsx`):** add timeframe state (default `'15m'`), a button group rendered from `/api/intervals`, and re-fetch candles on change. Keep the 5s poll for the *selected* interval. Levels/events are 15m-derived and stay as-is regardless of selected chart interval.
- **Chart (`components/Chart.tsx`):** the marker time offset is **hardcoded** today: `event.candleCloseTime - 15 * 60 * 1000`. Make it interval-aware (pass the active interval's ms, or anchor markers to `candleCloseTime` directly) or markers land on the wrong bar on non-15m charts. Reset `didInitialFitRef` on interval change so the chart refits to the new data range.

## v2.10 Rate-limit budget (the math that drives the throttle)

- Limit: **1200 weight / min / IP**, shared across all REST info calls.
- `candleSnapshot` estimated weight ≈ `20 + ceil(candleCount / 60)` → a 5000-candle request ≈ **~103 weight**. **Verify the exact formula in the rate-limit docs before relying on it.**
- **Cold start, all coins:** 14 coins × 4 intervals = **56 full requests** ≈ 56 × 103 ≈ **~5,800 weight** → must spread over ≥ ~5 min at a 900/min budget. Acceptable because it happens once; data is then cached.
- **Warm restart:** each `(coin, interval)` fetches only the gap (a handful of candles ≈ 20–21 weight each) → trivial.
- **Steady state:** ~0 REST — WebSocket carries all live updates.

The throttle (v2.5) is what makes the cold-start safe; the incremental fetch (v2.5) is what makes every subsequent start cheap.

## v2.11 Build order

1. **Config** — add `chartIntervals`, `backfillTarget`, budget knobs; startup validation.
2. **Store** — add `countCandles`.
3. **Backfill** — incremental + throttled per-interval loop; confirm via logs that SQLite fills to target counts per interval without 429s.
4. **API** — `interval` param + validation, raise clamp, `/api/intervals`.
5. **WS** — multi-interval subscribe; per-`(coin,interval)` keying; detection still 15m-only.
6. **Frontend** — switcher + interval-aware fetch + interval-aware markers.
7. Manual check: switch through 15m/1h/4h/1d on a coin and confirm each shows its full cached range and stays live.

## v2.12 Acceptance criteria

- [ ] 15m chart shows ~52 days of **real** candles (not 2–3); 1h ~208 days; 4h ~2.3 yrs; 1d ~13.7 yrs — bounded only by Hyperliquid's 5000 cap.
- [ ] Dashboard has a working 15m/1h/4h/1d switcher; switching repaints from cache instantly.
- [ ] No synthetic/derived candles anywhere — every displayed candle came from Hyperliquid at that interval.
- [ ] Cold start backfills all coins × intervals **without hitting the rate limit** (no 429s in logs).
- [ ] Warm restart fetches only gaps (verifiable: far fewer/smaller REST calls in logs).
- [ ] Steady state makes effectively no REST calls; all timeframes stay live via WS.
- [ ] Detection/alerts behave exactly as v1 — still 15m-only, unaffected by the selected chart interval.
- [ ] Event markers land on the correct bar on every timeframe, not just 15m.

## v2.13 Gotchas / verify-before-coding

- **Verify `candleSnapshot` weight formula and the WS subscription cap** against the current rate-limit docs — the v2.10 numbers are estimates.
- **Never synthesize lower-TF candles from higher-TF** — a 1d OHLC has no intraday path; fabricated 15m would corrupt touch/break/wick logic.
- **`liveCandles`/`processed` must key on `coin+interval`** once WS is multi-interval, or 15m close detection breaks.
- **Run detection only for `config.candleInterval`** in the closed-candle handler; higher-TF candles are chart-only.
- **Chart marker offset is hardcoded to 15m** — make it interval-aware.
- **Validate the `interval` query param** against `chartIntervals` before passing to the store.
- **Incremental backfill needs a small overlap** at `lastCandleTime` so no candle is missed across the boundary; the `ON CONFLICT` upsert dedupes it.
