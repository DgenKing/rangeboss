// Plain perps are referenced by bare symbol ("ETH").
// HIP-3 builder-deployed markets use a "dex:ASSET" form ("xyz:XYZ100", "xyz:SP500").
const DEFAULT_COINS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'HYPE', 'ZEC',
  'NEAR', 'WLD', 'XRP', 'TON', 'SUI', 'DOGE',
  'xyz:XYZ100', 'xyz:SP500',
];

// COINS env overrides the default list, e.g. COINS="ETH,SOL,xyz:SP500"
const coins = (process.env.COINS ?? DEFAULT_COINS.join(','))
  .split(',')
  .map(normalizeCoin)
  .filter(Boolean);

export const config = {
  coins,
  candleInterval: '15m',
  chartIntervals: ['15m', '1h', '4h', '1d'] as const,
  backfillTarget: {
    '15m': 5000,
    '1h': 5000,
    '4h': 5000,
    '1d': 5000,
  } as Record<string, number>,
  backfillWeightBudgetPerMin: 900,
  backfillRequestSpacingMs: 300,
  swingLookbackDays: 0,        // 0 = scroll back through ALL available history (no cap)
  pivotWindow: 5,
  trendMethod: 'structure',

  touchTolerance: 0.0008,      // 0.08%
  touchCooldownMinutes: 60,
  confirmWithinCandles: 3,
  stopBuffer: 0.0005,
  staleSocketSeconds: 90,
  apiPort: Number(process.env.API_PORT ?? 8787),
  pollMs: 5000,
  dbPath: process.env.DB_PATH ?? 'data/monitor.db',
  telegram: {
    botToken: process.env.TG_BOT_TOKEN ?? '',
    chatId: process.env.TG_CHAT_ID ?? '',
  },
  restUrl: 'https://api.hyperliquid.xyz/info',
  wsUrl: 'wss://api.hyperliquid.xyz/ws',
} as const;

export function assertValidConfig() {
  if (config.coins.length === 0) {
    throw new Error('No coins configured. Set the COINS env var.');
  }

  if (!config.chartIntervals.includes(config.candleInterval)) {
    throw new Error(`Detection interval ${config.candleInterval} must be listed in chartIntervals.`);
  }

  for (const interval of config.chartIntervals) {
    const target = config.backfillTarget[interval];
    if (!Number.isInteger(target) || target < 1 || target > 5000) {
      throw new Error(`Invalid backfill target for ${interval}: ${target}`);
    }
  }
}

export function isKnownCoin(coin: string): boolean {
  const target = normalizeCoin(coin);
  return config.coins.includes(target);
}

// Keep the "xyz:" dex prefix lowercase but the asset symbol uppercase.
export function normalizeCoin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.includes(':')) {
    const [dex, ...rest] = trimmed.split(':');
    return `${dex.toLowerCase()}:${rest.join(':').toUpperCase()}`;
  }
  return trimmed.toUpperCase();
}
