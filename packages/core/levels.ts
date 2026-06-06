import type { Candle, Levels } from './types';
import { detectTrend } from './trend';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ComputeLevelsOptions {
  coin: string;
  now?: number;
  swingLookbackDays?: number;
  pivotWindow?: number;
}

export type ComputeLevelsRangeOptions = Omit<ComputeLevelsOptions, 'now'>;

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
  const completedCandles = candles.filter((candle) => candle.closeTime <= todayStart);
  const yesterdayIndex = findYesterdayIndex(completedCandles, todayStart);

  if (yesterdayIndex < 0) {
    throw new Error('Not enough completed daily candles to compute levels');
  }

  const yesterday = completedCandles[yesterdayIndex];
  const rangeHigh = yesterday.high;
  const rangeLow = yesterday.low;
  // swingLookbackDays <= 0 means "scroll back through ALL available history".
  const earliestOpenTime = swingLookbackDays > 0
    ? yesterday.openTime - swingLookbackDays * DAY_MS
    : -Infinity;

  let swingHigh: number | null = null;
  let swingLow: number | null = null;

  for (let i = yesterdayIndex; i >= 0; i -= 1) {
    if (completedCandles[i].openTime < earliestOpenTime) break;

    if (swingHigh === null && isPivotHigh(completedCandles, i, pivotWindow)) {
      swingHigh = completedCandles[i].high;
    }

    if (swingLow === null && isPivotLow(completedCandles, i, pivotWindow)) {
      swingLow = completedCandles[i].low;
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
    trend: detectTrend(candles, now, pivotWindow),
  };
}

export function computeLevelsRange(
  dailyCandles: Candle[],
  from: number,
  to: number,
  options: ComputeLevelsRangeOptions,
): Levels[] {
  const candles = [...dailyCandles].sort((a, b) => a.openTime - b.openTime);
  if (candles.length === 0) return [];

  const firstLoadedDay = utcDayStart(candles[0].openTime);
  const fromDay = Math.max(utcDayStart(from), firstLoadedDay);
  const toDay = utcDayStart(to);
  const levels: Levels[] = [];
  let completedThroughIndex = -1;

  for (let day = fromDay; day <= toDay; day += DAY_MS) {
    while (
      completedThroughIndex + 1 < candles.length
      && candles[completedThroughIndex + 1].closeTime <= day
    ) {
      completedThroughIndex += 1;
    }

    const availableCandles = candles.slice(0, completedThroughIndex + 1);

    try {
      const activeLevels = computeLevels(availableCandles, { ...options, now: day });
      levels.push({
        ...activeLevels,
        computedAt: day,
        forUtcDay: formatUtcDate(day),
      });
    } catch {
      // Early loaded days may not have a completed prior daily candle yet.
    }
  }

  return levels;
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
