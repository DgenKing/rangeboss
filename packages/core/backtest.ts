import { ReversionSignalTracker, detectTouch, type DetectionOptions, type SignalOptions } from './detect';
import { computeLevels } from './levels';
import type { Candle, Direction, MarketEvent } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export type BacktestExitReason = 'TARGET' | 'STOP' | 'OPEN';

export interface BacktestOptions {
  coin: string;
  detection: DetectionOptions;
  signal: SignalOptions;
  recentCandleLimit?: number;
  recentEventLimit?: number;
  swingLookbackDays?: number;
  pivotWindow?: number;
}

export interface BacktestTrade {
  direction: Direction;
  levelName: MarketEvent['levelName'];
  levelPrice: number;
  signalTime: number;
  entry: number;
  stop: number;
  target: number;
  exitTime: number;
  exitPrice: number;
  exitReason: BacktestExitReason;
  rMultiple: number;
  returnPct: number;
  durationCandles: number;
  score: number;
}

export interface BacktestSummary {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netR: number;
  averageR: number;
  bestR: number;
  worstR: number;
  totalReturnPct: number;
}

export interface BacktestResult {
  firstCandleTime: number | null;
  lastCandleTime: number | null;
  strategyCandles: number;
  levelDays: number;
  touchEvents: number;
  breakEvents: number;
  signalEvents: number;
  trades: BacktestTrade[];
  summary: BacktestSummary;
}

export function runBacktest(
  strategyCandles: Candle[],
  dailyCandles: Candle[],
  options: BacktestOptions,
): BacktestResult {
  const candles = [...strategyCandles].sort((a, b) => a.openTime - b.openTime);
  const daily = [...dailyCandles].sort((a, b) => a.openTime - b.openTime);
  const tracker = new ReversionSignalTracker();
  const events: MarketEvent[] = [];
  const trades: BacktestTrade[] = [];
  const levelCache = new Map<number, ReturnType<typeof computeLevels> | null>();

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const levels = levelsForCandle(candle, daily, options, levelCache);
    if (!levels) continue;

    const recentCandles = candles.slice(Math.max(0, index - (options.recentCandleLimit ?? 40) + 1), index + 1);
    const recentEvents = events.slice(-(options.recentEventLimit ?? 200));
    const touchAndBreakEvents = detectTouch(candle, levels, options.detection, recentEvents);
    const signalEvents = tracker.update(
      candle,
      levels,
      touchAndBreakEvents.filter((event) => event.type === 'LEVEL_TOUCH'),
      recentCandles,
      options.signal,
    );

    events.push(...touchAndBreakEvents, ...signalEvents);

    for (const signal of signalEvents) {
      const trade = resolveTrade(signal, candles, index);
      if (trade) trades.push(trade);
    }
  }

  return {
    firstCandleTime: candles[0]?.openTime ?? null,
    lastCandleTime: candles.at(-1)?.closeTime ?? null,
    strategyCandles: candles.length,
    levelDays: [...levelCache.values()].filter(Boolean).length,
    touchEvents: events.filter((event) => event.type === 'LEVEL_TOUCH').length,
    breakEvents: events.filter((event) => event.type === 'LEVEL_BREAK').length,
    signalEvents: events.filter((event) => event.type === 'CONFIRMED_SIGNAL').length,
    trades,
    summary: summarizeTrades(trades),
  };
}

function levelsForCandle(
  candle: Candle,
  dailyCandles: Candle[],
  options: BacktestOptions,
  cache: Map<number, ReturnType<typeof computeLevels> | null>,
) {
  const todayStart = utcDayStart(candle.closeTime);
  if (cache.has(todayStart)) return cache.get(todayStart) ?? null;

  const availableDaily = dailyCandles.filter((daily) => daily.openTime < todayStart);
  try {
    const levels = computeLevels(availableDaily, {
      coin: options.coin,
      now: candle.closeTime,
      swingLookbackDays: options.swingLookbackDays ?? 0,
      pivotWindow: options.pivotWindow ?? 2,
    });
    cache.set(todayStart, levels);
    return levels;
  } catch {
    cache.set(todayStart, null);
    return null;
  }
}

function resolveTrade(signal: MarketEvent, candles: Candle[], signalIndex: number): BacktestTrade | null {
  if (
    signal.type !== 'CONFIRMED_SIGNAL' ||
    !signal.direction ||
    signal.entry === undefined ||
    signal.stop === undefined ||
    signal.target === undefined
  ) {
    return null;
  }

  for (let index = signalIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    const exit = exitForCandle(signal.direction, candle, signal.stop, signal.target);
    if (!exit) continue;

    return tradeFromExit(signal, exit.reason, exit.price, candle.closeTime, index - signalIndex);
  }

  const last = candles.at(-1);
  if (!last) return null;

  return tradeFromExit(signal, 'OPEN', last.close, last.closeTime, candles.length - signalIndex - 1);
}

function exitForCandle(
  direction: Direction,
  candle: Candle,
  stop: number,
  target: number,
): { reason: Exclude<BacktestExitReason, 'OPEN'>; price: number } | null {
  if (direction === 'LONG') {
    if (candle.low <= stop) return { reason: 'STOP', price: stop };
    if (candle.high >= target) return { reason: 'TARGET', price: target };
    return null;
  }

  if (candle.high >= stop) return { reason: 'STOP', price: stop };
  if (candle.low <= target) return { reason: 'TARGET', price: target };
  return null;
}

function tradeFromExit(
  signal: MarketEvent,
  exitReason: BacktestExitReason,
  exitPrice: number,
  exitTime: number,
  durationCandles: number,
): BacktestTrade {
  const entry = signal.entry!;
  const stop = signal.stop!;
  const target = signal.target!;
  const risk = Math.abs(entry - stop);
  const signedMove = signal.direction === 'LONG' ? exitPrice - entry : entry - exitPrice;
  const rMultiple = risk > 0 ? signedMove / risk : 0;

  return {
    direction: signal.direction!,
    levelName: signal.levelName,
    levelPrice: signal.levelPrice,
    signalTime: signal.candleCloseTime,
    entry,
    stop,
    target,
    exitTime,
    exitPrice,
    exitReason,
    rMultiple,
    returnPct: entry > 0 ? signedMove / entry : 0,
    durationCandles,
    score: signal.score ?? 0,
  };
}

function summarizeTrades(trades: BacktestTrade[]): BacktestSummary {
  const closed = trades.filter((trade) => trade.exitReason !== 'OPEN');
  const rValues = trades.map((trade) => trade.rMultiple);
  const netR = sum(rValues);

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    wins: closed.filter((trade) => trade.rMultiple > 0).length,
    losses: closed.filter((trade) => trade.rMultiple <= 0).length,
    winRate: closed.length > 0 ? closed.filter((trade) => trade.rMultiple > 0).length / closed.length : 0,
    netR,
    averageR: trades.length > 0 ? netR / trades.length : 0,
    bestR: trades.length > 0 ? Math.max(...rValues) : 0,
    worstR: trades.length > 0 ? Math.min(...rValues) : 0,
    totalReturnPct: sum(trades.map((trade) => trade.returnPct)),
  };
}

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
