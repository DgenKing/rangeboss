import type { Candle, MarketRegime } from './types';

export interface RegimeOptions {
  adxPeriod: number;
  adxThreshold: number;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  slowEmaSlopeLookback: number;
}

export interface IndicatorSnapshot {
  candleCloseTime: number;
  ready: boolean;
  emaFast: number;
  emaSlow: number;
  atr: number;
  rsi: number;
  adx: number;
  regime: MarketRegime;
}

export const defaultRegimeOptions: RegimeOptions = {
  adxPeriod: 14,
  adxThreshold: 22,
  fastEmaPeriod: 20,
  slowEmaPeriod: 50,
  slowEmaSlopeLookback: 10,
};

export function calculateIndicatorSeries(
  candles: Candle[],
  options: RegimeOptions = defaultRegimeOptions,
): IndicatorSnapshot[] {
  if (candles.length === 0) return [];

  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  const closes = sorted.map((candle) => candle.close);
  const emaFast = emaSeries(closes, options.fastEmaPeriod);
  const emaSlow = emaSeries(closes, options.slowEmaPeriod);
  const atr = atrSeries(sorted, options.adxPeriod);
  const rsi = rsiSeries(closes, options.adxPeriod);
  const adx = adxSeries(sorted, options.adxPeriod);
  const warmup = Math.max(
    options.slowEmaPeriod + options.slowEmaSlopeLookback,
    options.adxPeriod * 2,
  );

  return sorted.map((candle, index) => ({
    candleCloseTime: candle.closeTime,
    ready: index >= warmup,
    emaFast: emaFast[index],
    emaSlow: emaSlow[index],
    atr: atr[index],
    rsi: rsi[index],
    adx: adx[index],
    regime: classifyRegime({
      index,
      warmup,
      emaFast,
      emaSlow,
      adx,
      options,
    }),
  }));
}

export function latestIndicatorAt(
  series: IndicatorSnapshot[],
  timestamp: number,
): IndicatorSnapshot | null {
  let low = 0;
  let high = series.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].candleCloseTime <= timestamp) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found >= 0 ? series[found] : null;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const alpha = 2 / (period + 1);
  const output = [values[0]];

  for (let index = 1; index < values.length; index += 1) {
    output.push(alpha * values[index] + (1 - alpha) * output[index - 1]);
  }

  return output;
}

export function atrSeries(candles: Candle[], period = 14): number[] {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return wilderSeries(trueRanges, period);
}

export function rsiSeries(values: number[], period = 14): number[] {
  if (values.length === 0) return [];
  const gains = [0];
  const losses = [0];

  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }

  const averageGains = wilderSeries(gains, period);
  const averageLosses = wilderSeries(losses, period);
  return averageGains.map((gain, index) => {
    const loss = averageLosses[index];
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  });
}

export function adxSeries(candles: Candle[], period = 14): number[] {
  if (candles.length === 0) return [];
  const trueRanges: number[] = [];
  const positiveDm: number[] = [];
  const negativeDm: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (index === 0) {
      trueRanges.push(candle.high - candle.low);
      positiveDm.push(0);
      negativeDm.push(0);
      continue;
    }

    const previous = candles[index - 1];
    const upMove = candle.high - previous.high;
    const downMove = previous.low - candle.low;
    trueRanges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    ));
    positiveDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    negativeDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const smoothedTr = wilderSeries(trueRanges, period);
  const smoothedPositive = wilderSeries(positiveDm, period);
  const smoothedNegative = wilderSeries(negativeDm, period);
  const dx = smoothedTr.map((range, index) => {
    if (range === 0) return 0;
    const positiveDi = 100 * smoothedPositive[index] / range;
    const negativeDi = 100 * smoothedNegative[index] / range;
    const total = positiveDi + negativeDi;
    return total === 0 ? 0 : 100 * Math.abs(positiveDi - negativeDi) / total;
  });

  return wilderSeries(dx, period);
}

function classifyRegime(params: {
  index: number;
  warmup: number;
  emaFast: number[];
  emaSlow: number[];
  adx: number[];
  options: RegimeOptions;
}): MarketRegime {
  const { index, warmup, emaFast, emaSlow, adx, options } = params;
  if (index < warmup || adx[index] < options.adxThreshold) return 'RANGE';

  const priorSlow = emaSlow[index - options.slowEmaSlopeLookback];
  if (emaFast[index] > emaSlow[index] && emaSlow[index] > priorSlow) return 'UPTREND';
  if (emaFast[index] < emaSlow[index] && emaSlow[index] < priorSlow) return 'DOWNTREND';
  return 'RANGE';
}

function wilderSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const output: number[] = [];
  let average = values[0];

  for (let index = 0; index < values.length; index += 1) {
    average = index === 0
      ? values[index]
      : (average * (period - 1) + values[index]) / period;
    output.push(average);
  }

  return output;
}
