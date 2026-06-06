export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Levels {
  coin: string;
  computedAt: number;
  forUtcDay: string;
  rangeHigh: number;
  rangeLow: number;
  swingHigh: number | null;
  swingLow: number | null;
}

export type EventType = 'LEVEL_TOUCH' | 'LEVEL_BREAK' | 'CONFIRMED_SIGNAL';
export type Side = 'RESISTANCE' | 'SUPPORT';
export type Direction = 'LONG' | 'SHORT';
export type MarketRegime = 'UPTREND' | 'DOWNTREND' | 'RANGE';
export type StrategyName = 'RANGE_REVERSION' | 'TREND_MOMENTUM';
export type LevelName = 'rangeHigh' | 'rangeLow' | 'swingHigh' | 'swingLow' | 'trendBreakoutHigh' | 'trendBreakoutLow';

export interface MarketEvent {
  id?: number;
  type: EventType;
  coin: string;
  side: Side;
  levelName: LevelName;
  levelPrice: number;
  candleCloseTime: number;
  price: number;
  direction?: Direction;
  entry?: number;
  stop?: number;
  target?: number;
  score?: number;
  strategy?: StrategyName;
  regime?: MarketRegime;
  notified: boolean;
}
