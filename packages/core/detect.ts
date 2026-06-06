import type { Candle, LevelName, Levels, MarketEvent, Side } from './types';

export interface DetectionOptions {
  touchTolerance: number;
  touchCooldownMinutes: number;
}

export interface SignalOptions {
  confirmWithinCandles: number;
  stopBuffer: number;
}

type LevelRef = {
  name: LevelName;
  price: number;
  side: Side;
};

type PendingSetup = {
  touch: MarketEvent;
  candleA: Candle;
  candlesSinceTouch: number;
  confirmation?: Candle;
};

export function detectTouch(
  candle: Candle,
  levels: Levels,
  options: DetectionOptions,
  recentEvents: MarketEvent[] = [],
): MarketEvent[] {
  const events: MarketEvent[] = [];
  const cooldownMs = options.touchCooldownMinutes * 60 * 1000;

  for (const level of levelRefs(levels)) {
    if (level.side === 'RESISTANCE') {
      if (candle.close > level.price * (1 + options.touchTolerance)) {
        if (!recentEventWithinCooldown(recentEvents, 'LEVEL_BREAK', level, candle.closeTime, cooldownMs)) {
          events.push(baseEvent('LEVEL_BREAK', levels, level, candle));
        }
      } else if (
        candle.high >= level.price * (1 - options.touchTolerance) &&
        candle.close <= level.price &&
        !recentEventWithinCooldown(recentEvents, 'LEVEL_TOUCH', level, candle.closeTime, cooldownMs)
      ) {
        events.push(baseEvent('LEVEL_TOUCH', levels, level, candle));
      }
    } else {
      if (candle.close < level.price * (1 - options.touchTolerance)) {
        if (!recentEventWithinCooldown(recentEvents, 'LEVEL_BREAK', level, candle.closeTime, cooldownMs)) {
          events.push(baseEvent('LEVEL_BREAK', levels, level, candle));
        }
      } else if (
        candle.low <= level.price * (1 + options.touchTolerance) &&
        candle.close >= level.price &&
        !recentEventWithinCooldown(recentEvents, 'LEVEL_TOUCH', level, candle.closeTime, cooldownMs)
      ) {
        events.push(baseEvent('LEVEL_TOUCH', levels, level, candle));
      }
    }
  }

  return events;
}

export class ReversionSignalTracker {
  private pending: PendingSetup[] = [];

  reset() {
    this.pending = [];
  }

  update(
    candle: Candle,
    levels: Levels,
    touchEvents: MarketEvent[],
    recentCandles: Candle[],
    options: SignalOptions,
  ): MarketEvent[] {
    const signals: MarketEvent[] = [];
    const stillPending: PendingSetup[] = [];

    for (const setup of this.pending) {
      setup.candlesSinceTouch += 1;

      if (!setup.confirmation) {
        if (setup.candlesSinceTouch > options.confirmWithinCandles) {
          continue;
        }

        if (isConfirmation(setup.touch.side, setup.candleA, candle)) {
          setup.confirmation = candle;
          stillPending.push(setup);
        } else {
          stillPending.push(setup);
        }

        continue;
      }

      const signal = maybeTriggerSignal(setup, candle, levels, recentCandles, options);
      if (signal) {
        signals.push(signal);
      } else {
        stillPending.push(setup);
      }
    }

    for (const touch of touchEvents) {
      if (touch.type === 'LEVEL_TOUCH') {
        this.pending.push({
          touch,
          candleA: candle,
          candlesSinceTouch: 0,
        });
      }
    }

    this.pending = [...stillPending, ...this.pending.filter((setup) => setup.candleA === candle)];
    return signals;
  }
}

export function scoreSignal(params: {
  touch: MarketEvent;
  entry: number;
  stop: number;
  target: number;
  confirmation: Candle;
  recentCandles: Candle[];
}): number {
  let score = 40;

  if (params.touch.levelName === 'swingHigh' || params.touch.levelName === 'swingLow') {
    score += 20;
  }

  const averageBody = average(
    params.recentCandles
      .slice(-10)
      .map((candle) => Math.abs(candle.close - candle.open)),
  );
  const confirmationBody = Math.abs(params.confirmation.close - params.confirmation.open);
  if (averageBody > 0 && confirmationBody > averageBody) {
    score += 20;
  }

  const risk = Math.abs(params.entry - params.stop);
  const reward = Math.abs(params.target - params.entry);
  if (risk > 0 && reward / risk >= 2) {
    score += 20;
  }

  return Math.min(100, Math.max(0, score));
}

function maybeTriggerSignal(
  setup: PendingSetup,
  candle: Candle,
  levels: Levels,
  recentCandles: Candle[],
  options: SignalOptions,
): MarketEvent | null {
  const confirmation = setup.confirmation;
  if (!confirmation) return null;

  if (setup.touch.side === 'SUPPORT') {
    if (candle.high < confirmation.high) return null;

    const entry = confirmation.high;
    const stop = Math.min(setup.candleA.low, confirmation.low) * (1 - options.stopBuffer);
    const target = setup.touch.levelName === 'rangeLow' ? levels.rangeHigh : levels.swingHigh;
    if (target === null) return null;

    return confirmedEvent(setup, candle, entry, stop, target, recentCandles, 'LONG');
  }

  if (candle.low > confirmation.low) return null;

  const entry = confirmation.low;
  const stop = Math.max(setup.candleA.high, confirmation.high) * (1 + options.stopBuffer);
  const target = setup.touch.levelName === 'rangeHigh' ? levels.rangeLow : levels.swingLow;
  if (target === null) return null;

  return confirmedEvent(setup, candle, entry, stop, target, recentCandles, 'SHORT');
}

function confirmedEvent(
  setup: PendingSetup,
  candle: Candle,
  entry: number,
  stop: number,
  target: number,
  recentCandles: Candle[],
  direction: 'LONG' | 'SHORT',
): MarketEvent {
  const score = scoreSignal({
    touch: setup.touch,
    entry,
    stop,
    target,
    confirmation: setup.confirmation!,
    recentCandles,
  });

  return {
    type: 'CONFIRMED_SIGNAL',
    coin: setup.touch.coin,
    side: setup.touch.side,
    levelName: setup.touch.levelName,
    levelPrice: setup.touch.levelPrice,
    candleCloseTime: candle.closeTime,
    price: candle.close,
    direction,
    entry,
    stop,
    target,
    score,
    notified: false,
  };
}

function isConfirmation(side: Side, candleA: Candle, candleB: Candle): boolean {
  if (side === 'SUPPORT') {
    return candleB.close > candleB.open && candleB.low >= candleA.low;
  }

  return candleB.close < candleB.open && candleB.high <= candleA.high;
}

function levelRefs(levels: Levels): LevelRef[] {
  const refs: Array<LevelRef | null> = [
    { name: 'rangeHigh', price: levels.rangeHigh, side: 'RESISTANCE' },
    levels.swingHigh === null ? null : { name: 'swingHigh', price: levels.swingHigh, side: 'RESISTANCE' },
    { name: 'rangeLow', price: levels.rangeLow, side: 'SUPPORT' },
    levels.swingLow === null ? null : { name: 'swingLow', price: levels.swingLow, side: 'SUPPORT' },
  ];

  return refs.filter((ref): ref is LevelRef => ref !== null);
}

function baseEvent(
  type: 'LEVEL_TOUCH' | 'LEVEL_BREAK',
  levels: Levels,
  level: LevelRef,
  candle: Candle,
): MarketEvent {
  return {
    type,
    coin: levels.coin,
    side: level.side,
    levelName: level.name,
    levelPrice: level.price,
    candleCloseTime: candle.closeTime,
    price: candle.close,
    notified: false,
  };
}

function recentEventWithinCooldown(
  recentEvents: MarketEvent[],
  type: 'LEVEL_TOUCH' | 'LEVEL_BREAK',
  level: LevelRef,
  candleCloseTime: number,
  cooldownMs: number,
): boolean {
  return recentEvents.some((event) => (
    event.type === type &&
    event.side === level.side &&
    event.levelName === level.name &&
    candleCloseTime - event.candleCloseTime < cooldownMs
  ));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
