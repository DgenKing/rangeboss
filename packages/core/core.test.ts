import { describe, expect, test } from 'bun:test';
import { runBacktest } from './backtest';
import { ReversionSignalTracker, detectTouch } from './detect';
import { computeLevels } from './levels';
import type { Candle, Levels, MarketEvent } from './types';

const DAY = 24 * 60 * 60 * 1000;
const FIFTEEN = 15 * 60 * 1000;
const now = Date.UTC(2026, 5, 3, 12);

describe('computeLevels', () => {
  test('computes range and nearest swing pivots using completed UTC daily candles', () => {
    const candles = dailyFixture([
      [100, 80],
      [110, 84],
      [108, 82],
      [130, 81],
      [112, 83],
      [109, 78],
      [115, 86],
      [111, 85],
      [107, 79],
      [105, 90],
    ]);

    const levels = computeLevels(candles, {
      coin: 'ETH',
      now,
      swingLookbackDays: 90,
      pivotWindow: 2,
    });

    expect(levels.forUtcDay).toBe('2026-06-02');
    expect(levels.rangeHigh).toBe(105);
    expect(levels.rangeLow).toBe(90);
    expect(levels.swingHigh).toBe(115);
    expect(levels.swingLow).toBe(78);
  });

  test('rejects a swing that is not at least swingMinDistancePct beyond the range', () => {
    // Mirrors the HYPE-at-ATH case: the nearest pivot high is barely above the
    // range high (fake precision) so swingHigh must be null; the swing low sits
    // well below the range low and survives.
    const candles = dailyFixture([
      [99, 96],
      [99, 94],
      [98, 70],     // pivot low 70, well below range low -> valid swingLow
      [99, 94],
      [100.3, 92],  // pivot high 100.3, only 0.3% above range high -> rejected
      [99, 96],
      [98, 97],
      [100, 95],    // yesterday: rangeHigh 100, rangeLow 95
    ]);

    const levels = computeLevels(candles, {
      coin: 'ETH',
      now,
      swingLookbackDays: 0,
      pivotWindow: 2,
      swingMinDistancePct: 0.015,
    });

    expect(levels.rangeHigh).toBe(100);
    expect(levels.swingHigh).toBeNull();
    expect(levels.swingLow).toBe(70);
  });

  test('returns null for missing swing levels inside the lookback', () => {
    const candles = dailyFixture([
      [100, 90],
      [101, 91],
      [102, 92],
      [103, 93],
      [104, 94],
      [105, 95],
    ]);

    const levels = computeLevels(candles, {
      coin: 'SOL',
      now,
      swingLookbackDays: 90,
      pivotWindow: 2,
    });

    expect(levels.rangeHigh).toBe(105);
    expect(levels.rangeLow).toBe(95);
    expect(levels.swingHigh).toBeNull();
    expect(levels.swingLow).toBeNull();
  });
});

describe('detectTouch', () => {
  test('emits a support touch when price rejects and closes back above the level', () => {
    const [event] = detectTouch(
      candle(0, 100, 101, 94.95, 95.4),
      testLevels(),
      { touchTolerance: 0.0008, touchCooldownMinutes: 60 },
    );

    expect(event.type).toBe('LEVEL_TOUCH');
    expect(event.side).toBe('SUPPORT');
    expect(event.levelName).toBe('rangeLow');
  });

  test('emits a break when close moves through a support level', () => {
    const [event] = detectTouch(
      candle(0, 96, 97, 94, 94.8),
      testLevels(),
      { touchTolerance: 0.0008, touchCooldownMinutes: 60 },
    );

    expect(event.type).toBe('LEVEL_BREAK');
    expect(event.side).toBe('SUPPORT');
  });

  test('suppresses duplicate touch events inside the cooldown window', () => {
    const recent: MarketEvent[] = [{
      type: 'LEVEL_TOUCH',
      coin: 'ETH',
      side: 'SUPPORT',
      levelName: 'rangeLow',
      levelPrice: 95,
      candleCloseTime: candle(1, 96, 97, 94.95, 95.5).closeTime,
      price: 95.5,
      notified: true,
    }];

    const events = detectTouch(
      candle(2, 100, 101, 94.95, 95.4),
      testLevels(),
      { touchTolerance: 0.0008, touchCooldownMinutes: 60 },
      recent,
    );

    expect(events).toHaveLength(0);
  });
});

describe('ReversionSignalTracker', () => {
  test('emits a confirmed long signal after support touch, confirmation, and trigger', () => {
    const tracker = new ReversionSignalTracker();
    const levels = testLevels();
    const history = Array.from({ length: 10 }, (_, index) => candle(index, 100, 100.4, 99.8, 100.1));

    const candleA = candle(10, 96, 96.5, 94.95, 95.5);
    const touches = detectTouch(candleA, levels, { touchTolerance: 0.0008, touchCooldownMinutes: 60 });
    expect(touches[0].type).toBe('LEVEL_TOUCH');
    expect(tracker.update(candleA, levels, touches, history, signalOptions())).toHaveLength(0);

    const candleB = candle(11, 95.6, 97, 95.1, 96.8);
    expect(tracker.update(candleB, levels, [], [...history, candleA], signalOptions())).toHaveLength(0);

    const candleC = candle(12, 96.7, 97.2, 96.4, 97.1);
    const [signal] = tracker.update(candleC, levels, [], [...history, candleA, candleB], signalOptions());

    expect(signal.type).toBe('CONFIRMED_SIGNAL');
    expect(signal.direction).toBe('LONG');
    expect(signal.entry).toBe(97);
    expect(signal.target).toBe(110);
    expect(signal.score).toBeGreaterThanOrEqual(60);
  });

  test('invalidates a setup when no confirmation appears within the configured window', () => {
    const tracker = new ReversionSignalTracker();
    const levels = testLevels();
    const candleA = candle(20, 96, 96.5, 94.95, 95.5);
    const touches = detectTouch(candleA, levels, { touchTolerance: 0.0008, touchCooldownMinutes: 60 });

    tracker.update(candleA, levels, touches, [], signalOptions());
    tracker.update(candle(21, 96, 96.2, 94.8, 95.9), levels, [], [], signalOptions());
    tracker.update(candle(22, 95.9, 96, 94.7, 95.8), levels, [], [], signalOptions());
    tracker.update(candle(23, 95.8, 96, 94.6, 95.7), levels, [], [], signalOptions());

    const events = tracker.update(candle(24, 95.7, 97, 95.1, 96.8), levels, [], [], signalOptions());
    expect(events).toHaveLength(0);
  });
});

describe('runBacktest', () => {
  test('simulates a confirmed long trade from the first available strategy candle', () => {
    const dailyCandles = dailyFixture([
      [100, 80],
      [110, 84],
      [108, 82],
      [130, 81],
      [112, 83],
      [109, 78],
      [115, 86],
      [111, 85],
      [107, 88],
      [110, 95],
    ]);
    const strategyCandles = [
      candle(0, 100, 100.4, 99.8, 100.1),
      candle(1, 96, 96.5, 94.95, 95.5),
      candle(2, 95.6, 97, 95.1, 96.8),
      candle(3, 96.7, 97.2, 96.4, 97.1),
      candle(4, 97.2, 110.5, 97, 110.2),
    ];

    const result = runBacktest(strategyCandles, dailyCandles, {
      coin: 'ETH',
      detection: { touchTolerance: 0.0008, touchCooldownMinutes: 60 },
      signal: signalOptions(),
    });

    expect(result.firstCandleTime).toBe(strategyCandles[0].openTime);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].direction).toBe('LONG');
    expect(result.trades[0].entry).toBe(97);
    expect(result.trades[0].exitReason).toBe('TARGET');
    expect(result.trades[0].exitPrice).toBe(110);
    expect(result.summary.closedTrades).toBe(1);
    expect(result.summary.wins).toBe(1);
    expect(result.summary.netR).toBeGreaterThan(6);
  });

  test('recomputes historical daily levels instead of using a single current snapshot', () => {
    const dailyCandles = dailyFixture([
      [100, 80],
      [110, 84],
      [108, 82],
      [130, 81],
      [112, 83],
      [109, 78],
      [115, 86],
      [111, 85],
      [107, 88],
      [110, 95],
      [140, 100],
    ]);
    const strategyCandles = [
      candle(0, 100, 100.4, 99.8, 100.1),
      candle(1, 96, 96.5, 94.95, 95.5),
      candle(2, 95.6, 97, 95.1, 96.8),
      candle(3, 96.7, 97.2, 96.4, 97.1),
      candle(4, 97.2, 110.5, 97, 110.2),
    ];

    const result = runBacktest(strategyCandles, dailyCandles, {
      coin: 'ETH',
      detection: { touchTolerance: 0.0008, touchCooldownMinutes: 60 },
      signal: signalOptions(),
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].target).toBe(110);
  });
});

function dailyFixture(values: Array<[high: number, low: number]>): Candle[] {
  const firstOpen = Date.UTC(2026, 4, 24);
  return values.map(([high, low], index) => ({
    openTime: firstOpen + index * DAY,
    closeTime: firstOpen + (index + 1) * DAY,
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 1,
  }));
}

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  const openTime = Date.UTC(2026, 5, 3) + index * FIFTEEN;
  return {
    openTime,
    closeTime: openTime + FIFTEEN,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

function testLevels(): Levels {
  return {
    coin: 'ETH',
    computedAt: now,
    forUtcDay: '2026-06-02',
    rangeHigh: 110,
    rangeLow: 95,
    swingHigh: 120,
    swingLow: 80,
  };
}

function signalOptions() {
  return {
    confirmWithinCandles: 3,
    stopBuffer: 0.0005,
  };
}
