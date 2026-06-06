import { isPivotHigh, isPivotLow } from './levels';
import type { Candle, Trend } from './types';

export function detectTrend(
  dailyCandles: Candle[],
  now: number,
  pivotWindow: number,
): Trend {
  const completedCandles = dailyCandles
    .filter((candle) => candle.closeTime <= utcDayStart(now))
    .sort((a, b) => a.openTime - b.openTime);

  const pivotHighs: Candle[] = [];
  const pivotLows: Candle[] = [];

  for (let index = 0; index < completedCandles.length; index += 1) {
    if (isPivotHigh(completedCandles, index, pivotWindow)) {
      pivotHighs.push(completedCandles[index]);
    }
    if (isPivotLow(completedCandles, index, pivotWindow)) {
      pivotLows.push(completedCandles[index]);
    }
  }

  if (pivotHighs.length < 2 || pivotLows.length < 2) {
    return 'SIDE';
  }

  const ph1 = pivotHighs[pivotHighs.length - 1];
  const ph2 = pivotHighs[pivotHighs.length - 2];
  const pl1 = pivotLows[pivotLows.length - 1];
  const pl2 = pivotLows[pivotLows.length - 2];

  if (ph1.high > ph2.high && pl1.low > pl2.low) {
    return 'UP';
  }

  if (ph1.high < ph2.high && pl1.low < pl2.low) {
    return 'DOWN';
  }

  return 'SIDE';
}

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
