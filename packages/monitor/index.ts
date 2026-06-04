import { assertValidConfig, config } from '../../config';
import { ReversionSignalTracker, detectTouch } from '../core/detect';
import { computeLevels } from '../core/levels';
import type { Candle, Levels, MarketEvent } from '../core/types';
import { startApi } from './api';
import { fetchCandles, HyperliquidSocket } from './hyperliquid';
import { Store } from './store';
import { formatEvent, sendAlert } from './telegram';

const FIFTEEN_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

assertValidConfig();

const store = new Store(config.dbPath);
const status = {
  coins: [...config.coins],
  socketHealthy: false,
  prices: Object.fromEntries(config.coins.map((coin) => [coin, null])) as Record<string, number | null>,
};

const trackers = new Map<string, ReversionSignalTracker>();
const activeLevels = new Map<string, Levels>();
for (const coin of config.coins) {
  trackers.set(coin, new ReversionSignalTracker());
}

// Start the API first so the dashboard can connect immediately while backfill runs.
startApi(store, status);

for (const coin of config.coins) {
  try {
    await backfillAndComputeLevels(coin);
  } catch (error) {
    console.error(`Backfill failed for ${coin}:`, error instanceof Error ? error.message : error);
  }
}

scheduleUtcRolloverCheck();

const socket = new HyperliquidSocket(
  {
    wsUrl: config.wsUrl,
    coins: [...config.coins],
    interval: config.candleInterval,
    staleSocketSeconds: config.staleSocketSeconds,
  },
  {
    onClosedCandle: handleClosedCandle,
    onCurrentPrice: (coin, price) => {
      status.prices[coin] = price;
    },
    onHealth: (healthy) => {
      status.socketHealthy = healthy;
    },
    onLog: (message) => console.log(message),
  },
);

socket.start();

process.on('SIGINT', () => {
  socket.stop();
  store.close();
  process.exit(0);
});

async function backfillAndComputeLevels(coin: string) {
  const endTime = Date.now();
  const candles15m = await fetchCandles({
    restUrl: config.restUrl,
    coin,
    interval: config.candleInterval,
    startTime: endTime - 320 * FIFTEEN_MS,
    endTime,
  });
  store.saveCandles(coin, config.candleInterval, candles15m);

  // Fetch full daily history (API caps at 5000 candles) so the swing scan can
  // "scroll left" as far back as needed to find a level beyond the range.
  const dailyCandles = await fetchCandles({
    restUrl: config.restUrl,
    coin,
    interval: '1d',
    startTime: endTime - 5000 * DAY_MS,
    endTime,
  });
  store.saveCandles(coin, '1d', dailyCandles);

  const levels = computeLevels(dailyCandles, {
    coin,
    swingLookbackDays: config.swingLookbackDays,
    pivotWindow: config.pivotWindow,
  });
  activeLevels.set(coin, levels);
  store.saveLevels(levels);

  console.log(`Levels for ${coin} ${levels.forUtcDay}:`, {
    rangeHigh: levels.rangeHigh,
    rangeLow: levels.rangeLow,
    swingHigh: levels.swingHigh,
    swingLow: levels.swingLow,
  });
}

async function handleClosedCandle(coin: string, candle: Candle) {
  const levels = activeLevels.get(coin);
  if (!levels) return;

  store.saveCandles(coin, config.candleInterval, [candle]);
  const recentCandles = store.getRecentCandles(coin, config.candleInterval, 40);
  const recentEvents = store.getRecentEvents(coin, 200);

  const touchAndBreakEvents = detectTouch(
    candle,
    levels,
    {
      touchTolerance: config.touchTolerance,
      touchCooldownMinutes: config.touchCooldownMinutes,
    },
    recentEvents,
  );

  const tracker = trackers.get(coin);
  const signalEvents = tracker
    ? tracker.update(
        candle,
        levels,
        touchAndBreakEvents.filter((event) => event.type === 'LEVEL_TOUCH'),
        recentCandles,
        {
          confirmWithinCandles: config.confirmWithinCandles,
          stopBuffer: config.stopBuffer,
        },
      )
    : [];

  await persistAndNotify([...touchAndBreakEvents, ...signalEvents]);
}

async function persistAndNotify(events: MarketEvent[]) {
  if (events.length === 0) return;

  const saved = store.saveEvents(events);
  for (const event of saved) {
    console.log(formatEvent(event));

    try {
      const delivered = await sendAlert(event, config.telegram);
      if (delivered && event.id) {
        store.markNotified(event.id);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }
}

function scheduleUtcRolloverCheck() {
  const levelDays = new Map<string, string | undefined>();
  for (const [coin, levels] of activeLevels) {
    levelDays.set(coin, levels.forUtcDay);
  }

  setInterval(() => {
    const latestCompletedDay = latestCompletedUtcDay();
    for (const coin of config.coins) {
      if (levelDays.get(coin) !== latestCompletedDay) {
        void backfillAndComputeLevels(coin)
          .then(() => {
            levelDays.set(coin, activeLevels.get(coin)?.forUtcDay);
          })
          .catch((error) => {
            console.error(`Rollover recompute failed for ${coin}:`, error instanceof Error ? error.message : error);
          });
      }
    }
  }, 60_000);
}

function latestCompletedUtcDay() {
  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayStart - DAY_MS).toISOString().slice(0, 10);
}
