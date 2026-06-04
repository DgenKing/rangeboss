import type { Candle, Levels } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ComputeLevelsOptions {
  coin: string;
  now?: number;
  swingLookbackDays?: number;
  pivotWindow?: number;
}

export function computeLevels(
  dailyCandles: Candle[],
  {
    coin,
    now = Date.now(),
    swingLookbackDays = 90,
    pivotWindow = 2,
  }: ComputeLevelsOptions,
): Levels {
  const candles = [...dailyCandles].sort((a, b) => a.openTime - b.openTime);
  const todayStart = utcDayStart(now);
  const yesterdayIndex = findYesterdayIndex(candles, todayStart);

  if (yesterdayIndex < 0) {
    throw new Error('Not enough completed daily candles to compute levels');
  }

  const yesterday = candles[yesterdayIndex];
  const rangeHigh = yesterday.high;
  const rangeLow = yesterday.low;
  // swingLookbackDays <= 0 means "scroll back through ALL available history".
  const earliestOpenTime = swingLookbackDays > 0
    ? yesterday.openTime - swingLookbackDays * DAY_MS
    : -Infinity;

  let swingHigh: number | null = null;
  let swingLow: number | null = null;

  for (let i = yesterdayIndex; i >= 0; i -= 1) {
    if (candles[i].openTime < earliestOpenTime) break;

    if (swingHigh === null && isPivotHigh(candles, i, pivotWindow) && candles[i].high > rangeHigh) {
      swingHigh = candles[i].high;
    }

    if (swingLow === null && isPivotLow(candles, i, pivotWindow) && candles[i].low < rangeLow) {
      swingLow = candles[i].low;
    }

    if (swingHigh !== null && swingLow !== null) break;
  }

  return {
    coin,
    computedAt: now,
    forUtcDay: formatUtcDate(yesterday.openTime),
    rangeHigh,
    rangeLow,
    swingHigh,
    swingLow,
  };
}

export function isPivotHigh(candles: Candle[], index: number, window: number): boolean {
  if (index - window < 0 || index + window >= candles.length) return false;
  const value = candles[index].high;

  for (let distance = 1; distance <= window; distance += 1) {
    if (value < candles[index - distance].high || value < candles[index + distance].high) {
      return false;
    }
  }

  return true;
}

export function isPivotLow(candles: Candle[], index: number, window: number): boolean {
  if (index - window < 0 || index + window >= candles.length) return false;
  const value = candles[index].low;

  for (let distance = 1; distance <= window; distance += 1) {
    if (value > candles[index - distance].low || value > candles[index + distance].low) {
      return false;
    }
  }

  return true;
}

function findYesterdayIndex(candles: Candle[], todayStart: number): number {
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const candle = candles[i];
    if (candle.closeTime <= todayStart || candle.openTime < todayStart) {
      return i;
    }
  }

  return -1;
}

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
