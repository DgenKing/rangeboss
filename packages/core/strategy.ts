import { ReversionSignalTracker, detectTouch, type DetectionOptions, type SignalOptions } from './detect';
import { atrSeries, rsiSeries, type IndicatorSnapshot } from './indicators';
import type {
  Candle,
  Direction,
  Levels,
  MarketEvent,
  MarketRegime,
  StrategyName,
} from './types';

export interface TrendOptions {
  breakoutLookback: number;
  atrPeriod: number;
  atrStopMultiple: number;
  targetR: number;
  rsiPeriod: number;
  rsiLongMin: number;
  rsiShortMax: number;
}

export interface RegimeStrategyOptions {
  detection: DetectionOptions;
  rangeSignal: SignalOptions;
  range: {
    enabled: boolean;
    maxAdx: number;
    targetR: number;
    minScore: number;
  };
  trend: TrendOptions;
}

export interface StrategySignal extends MarketEvent {
  type: 'CONFIRMED_SIGNAL';
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  strategy: StrategyName;
  regime: MarketRegime;
}

export interface StrategyExit {
  signal: StrategySignal;
  exitTime: number;
  exitPrice: number;
  reason: 'TARGET' | 'STOP';
  durationCandles: number;
}

export interface StrategyUpdate {
  regime: IndicatorSnapshot | null;
  events: MarketEvent[];
  signals: StrategySignal[];
  exits: StrategyExit[];
  hasActiveTrade: boolean;
}

type ActiveTrade = {
  signal: StrategySignal;
  durationCandles: number;
};

type PendingTrend = {
  direction: Direction;
  regime: MarketRegime;
  atr: number;
  breakoutLevel: number;
};

export class RegimeAwareStrategyEngine {
  private readonly rangeTracker = new ReversionSignalTracker();
  private activeTrade: ActiveTrade | null = null;
  private pendingTrend: PendingTrend | null = null;

  update(params: {
    candle: Candle;
    levels: Levels;
    recentCandles: Candle[];
    recentEvents: MarketEvent[];
    regime: IndicatorSnapshot | null;
    options: RegimeStrategyOptions;
  }): StrategyUpdate {
    const { candle, levels, recentCandles, recentEvents, regime, options } = params;
    const events = detectTouch(candle, levels, options.detection, recentEvents);
    const signals: StrategySignal[] = [];
    const exits: StrategyExit[] = [];

    if (this.activeTrade) {
      this.activeTrade.durationCandles += 1;
      const exit = resolveExit(this.activeTrade, candle);
      if (exit) {
        exits.push(exit);
        this.activeTrade = null;
        return { regime, events, signals, exits, hasActiveTrade: false };
      } else {
        return { regime, events, signals, exits, hasActiveTrade: true };
      }
    }

    if (this.pendingTrend) {
      if (!regime?.ready || regime.regime !== this.pendingTrend.regime) {
        this.pendingTrend = null;
      } else {
        const signal = trendSignalFromPending(this.pendingTrend, candle, levels.coin, options.trend);
        this.pendingTrend = null;
        this.activeTrade = { signal, durationCandles: 0 };
        signals.push(signal);
        const exit = resolveExit(this.activeTrade, candle);
        if (exit) {
          exits.push(exit);
          this.activeTrade = null;
        }
        return { regime, events, signals, exits, hasActiveTrade: this.activeTrade !== null };
      }
    }

    if (regime?.ready === false) {
      this.rangeTracker.reset();
      this.pendingTrend = null;
    } else if (
      options.range.enabled &&
      (!regime || (regime.regime === 'RANGE' && regime.adx <= options.range.maxAdx))
    ) {
      const rangeSignals = this.rangeTracker.update(
        candle,
        levels,
        events.filter((event) => event.type === 'LEVEL_TOUCH'),
        recentCandles,
        options.rangeSignal,
      );
      const selected = rangeSignals
        .filter((signal) => (signal.score ?? 0) >= options.range.minScore)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .at(0);
      if (selected) {
        const signal = decorateRangeSignal(selected, options.range.targetR);
        this.activeTrade = { signal, durationCandles: 0 };
        signals.push(signal);
        const exit = resolveExit(this.activeTrade, candle);
        if (exit) {
          exits.push(exit);
          this.activeTrade = null;
        }
      }
    } else {
      this.rangeTracker.reset();
      this.pendingTrend = regime ? detectTrendBreakout(recentCandles, regime, options.trend) : null;
    }

    return { regime, events, signals, exits, hasActiveTrade: this.activeTrade !== null };
  }

  hasActiveTrade(): boolean {
    return this.activeTrade !== null;
  }
}

function detectTrendBreakout(
  candles: Candle[],
  regime: IndicatorSnapshot,
  options: TrendOptions,
): PendingTrend | null {
  if (candles.length <= Math.max(options.breakoutLookback, options.atrPeriod, options.rsiPeriod)) {
    return null;
  }

  const candle = candles.at(-1)!;
  const prior = candles.slice(-(options.breakoutLookback + 1), -1);
  const atr = atrSeries(candles, options.atrPeriod).at(-1) ?? 0;
  const rsi = rsiSeries(candles.map((item) => item.close), options.rsiPeriod).at(-1) ?? 50;
  if (atr <= 0) return null;

  if (regime.regime === 'UPTREND') {
    const high = Math.max(...prior.map((item) => item.high));
    if (candle.close > high && rsi >= options.rsiLongMin) {
      return { direction: 'LONG', regime: regime.regime, atr, breakoutLevel: high };
    }
  }

  if (regime.regime === 'DOWNTREND') {
    const low = Math.min(...prior.map((item) => item.low));
    if (candle.close < low && rsi <= options.rsiShortMax) {
      return { direction: 'SHORT', regime: regime.regime, atr, breakoutLevel: low };
    }
  }

  return null;
}

function trendSignalFromPending(
  pending: PendingTrend,
  candle: Candle,
  coin: string,
  options: TrendOptions,
): StrategySignal {
  const entry = candle.open;
  const risk = pending.atr * options.atrStopMultiple;
  const isLong = pending.direction === 'LONG';

  return {
    type: 'CONFIRMED_SIGNAL',
    coin,
    side: isLong ? 'RESISTANCE' : 'SUPPORT',
    levelName: isLong ? 'trendBreakoutHigh' : 'trendBreakoutLow',
    levelPrice: pending.breakoutLevel,
    candleCloseTime: candle.closeTime,
    price: candle.close,
    direction: pending.direction,
    entry,
    stop: isLong ? entry - risk : entry + risk,
    target: isLong ? entry + options.targetR * risk : entry - options.targetR * risk,
    score: 80,
    strategy: 'TREND_MOMENTUM',
    regime: pending.regime,
    notified: false,
  };
}

function decorateRangeSignal(event: MarketEvent, targetR: number): StrategySignal {
  const entry = event.entry!;
  const stop = event.stop!;
  const risk = Math.abs(entry - stop);
  const cappedTarget = event.direction === 'LONG'
    ? Math.min(event.target!, entry + risk * targetR)
    : Math.max(event.target!, entry - risk * targetR);
  return {
    ...event,
    type: 'CONFIRMED_SIGNAL',
    direction: event.direction!,
    entry,
    stop,
    target: cappedTarget,
    strategy: 'RANGE_REVERSION',
    regime: 'RANGE',
  };
}

function resolveExit(active: ActiveTrade, candle: Candle): StrategyExit | null {
  const { signal } = active;
  if (signal.direction === 'LONG') {
    if (candle.low <= signal.stop) return exit(active, candle, 'STOP', signal.stop);
    if (candle.high >= signal.target) return exit(active, candle, 'TARGET', signal.target);
    return null;
  }

  if (candle.high >= signal.stop) return exit(active, candle, 'STOP', signal.stop);
  if (candle.low <= signal.target) return exit(active, candle, 'TARGET', signal.target);
  return null;
}

function exit(
  active: ActiveTrade,
  candle: Candle,
  reason: StrategyExit['reason'],
  price: number,
): StrategyExit {
  return {
    signal: active.signal,
    exitTime: candle.closeTime,
    exitPrice: price,
    reason,
    durationCandles: active.durationCandles,
  };
}
