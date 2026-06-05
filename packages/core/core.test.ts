import { describe, expect, test } from 'bun:test';
import { ReversionSignalTracker, detectTouch } from './detect';
import { computeLevels, computeLevelsRange } from './levels';
import { detectTrend } from './trend';
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

  test('uses the most recent confirmed pivot as swing even when it is inside the range', () => {
    const candles = dailyFixture([
      [100, 90],
      [105, 88],
      [99, 89],
      [101, 87], // most recent confirmed pivot high and low
      [98, 88],
      [130, 80], // yesterday's range dwarfs the recent structure
    ]);

    const levels = computeLevels(candles, {
      coin: 'ETH',
      now,
      swingLookbackDays: 0,
      pivotWindow: 1,
    });

    expect(levels.rangeHigh).toBe(130);
    expect(levels.rangeLow).toBe(80);
    expect(levels.swingHigh).toBe(101);
    expect(levels.swingLow).toBe(87);
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

  test('computes historical levels for active UTC days without future candles', () => {
    const candles = dailyFixture([
      [100, 90],
      [120, 80], // active 2026-05-26 range; not yet a confirmed pivot without future candles
      [95, 86],
      [94, 87],
      [96, 88],
    ]);

    const history = computeLevelsRange(
      candles,
      Date.UTC(2026, 4, 25),
      Date.UTC(2026, 4, 28),
      {
        coin: 'ETH',
        swingLookbackDays: 0,
        pivotWindow: 1,
      },
    );

    expect(history.map((levels) => levels.forUtcDay)).toEqual(['2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28']);
    expect(history[1].rangeHigh).toBe(120);
    expect(history[1].rangeLow).toBe(80);
    expect(history[1].swingHigh).toBeNull();
  });
});

describe('detectTrend', () => {
  test('detects an uptrend from higher pivot highs and higher pivot lows', () => {
    expect(detectTrend(dailyFixture([
      [10, 5],
      [14, 8],
      [12, 6],
      [16, 9],
      [13, 7],
      [18, 11],
      [15, 10],
      [17, 12],
    ]), Date.UTC(2026, 5, 1), 1)).toBe('UP');
  });

  test('detects a downtrend from lower pivot highs and lower pivot lows', () => {
    expect(detectTrend(dailyFixture([
      [20, 12],
      [18, 8],
      [19, 10],
      [16, 6],
      [17, 9],
      [14, 4],
      [15, 7],
      [13, 5],
    ]), Date.UTC(2026, 5, 1), 1)).toBe('DOWN');
  });

  test('returns side when structure is mixed or pivots are insufficient', () => {
    expect(detectTrend(dailyFixture([
      [10, 5],
      [14, 8],
      [12, 6],
      [16, 7],
      [13, 4],
      [15, 9],
    ]), Date.UTC(2026, 5, 1), 1)).toBe('SIDE');

    expect(detectTrend(dailyFixture([
      [10, 5],
      [11, 6],
      [12, 7],
    ]), Date.UTC(2026, 5, 1), 1)).toBe('SIDE');
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
    expect(signal.trend).toBe('SIDE');
  });

  test('does not emit a long confirmed signal during a downtrend', () => {
    const tracker = new ReversionSignalTracker();
    const levels = { ...testLevels(), trend: 'DOWN' as const };
    const history = Array.from({ length: 10 }, (_, index) => candle(index, 100, 100.4, 99.8, 100.1));

    const candleA = candle(10, 96, 96.5, 94.95, 95.5);
    const touches = detectTouch(candleA, levels, { touchTolerance: 0.0008, touchCooldownMinutes: 60 });

    tracker.update(candleA, levels, touches, history, signalOptions('DOWN'));
    tracker.update(candle(11, 95.6, 97, 95.1, 96.8), levels, [], [...history, candleA], signalOptions('DOWN'));
    const events = tracker.update(candle(12, 96.7, 97.2, 96.4, 97.1), levels, [], history, signalOptions('DOWN'));

    expect(events).toHaveLength(0);
  });

  test('does not emit a short confirmed signal during an uptrend', () => {
    const tracker = new ReversionSignalTracker();
    const levels = { ...testLevels(), trend: 'UP' as const };
    const history = Array.from({ length: 10 }, (_, index) => candle(index, 100, 100.4, 99.8, 100.1));

    const candleA = candle(10, 109.4, 110.05, 108.5, 109.5);
    const touches = detectTouch(candleA, levels, { touchTolerance: 0.0008, touchCooldownMinutes: 60 });

    tracker.update(candleA, levels, touches, history, signalOptions('UP'));
    tracker.update(candle(11, 109.4, 109.8, 108.7, 108.9), levels, [], [...history, candleA], signalOptions('UP'));
    const events = tracker.update(candle(12, 108.8, 109, 108.6, 108.7), levels, [], history, signalOptions('UP'));

    expect(events).toHaveLength(0);
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
    trend: 'SIDE',
  };
}

function signalOptions(trend: 'UP' | 'DOWN' | 'SIDE' = 'SIDE') {
  return {
    confirmWithinCandles: 3,
    stopBuffer: 0.0005,
    trend,
  };
}
