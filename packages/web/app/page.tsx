'use client';

import { Clock, Wifi, WifiOff } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import {
  displayCoin,
  getCandles,
  getCoins,
  getDashboardData,
  getIntervals,
  type Candle,
  type Levels,
  type MarketEvent,
  type Status,
} from '../lib/api';
import { runBacktest, type BacktestResult, type BacktestTrade } from '../../core/backtest';

const Chart = dynamic(() => import('../components/Chart'), { ssr: false });

type Theme = 'light' | 'dusk' | 'dark';

type DashboardData = {
  levels: Levels | null;
  candles: Candle[];
  events: MarketEvent[];
  status: Status | null;
};

const emptyData: DashboardData = {
  levels: null,
  candles: [],
  events: [],
  status: null,
};

type BacktestLoadState = {
  result: BacktestResult | null;
  loading: boolean;
  error: string | null;
};

const emptyBacktest: BacktestLoadState = {
  result: null,
  loading: false,
  error: null,
};

const STRATEGY_INTERVAL = '15m';
const BACKTEST_HISTORY_LIMIT = 5000;
const BACKTEST_REFRESH_MS = 60_000;
const BACKTEST_OPTIONS = {
  detection: { touchTolerance: 0.0008, touchCooldownMinutes: 60 },
  strategy: {
    detection: { touchTolerance: 0.0008, touchCooldownMinutes: 60 },
    rangeSignal: { confirmWithinCandles: 3, stopBuffer: 0.0005 },
    range: { enabled: true, maxAdx: 12, targetR: 2, minScore: 80 },
    trend: {
      breakoutLookback: 40,
      atrPeriod: 14,
      atrStopMultiple: 2.5,
      targetR: 2.5,
      rsiPeriod: 14,
      rsiLongMin: 60,
      rsiShortMax: 40,
    },
  },
  regime: {
    adxPeriod: 14,
    adxThreshold: 22,
    fastEmaPeriod: 20,
    slowEmaPeriod: 50,
    slowEmaSlopeLookback: 10,
  },
  feePerSide: 0.00035,
  slippagePerSide: 0.00015,
  swingMinDistancePct: 0.015,
};

export default function Page() {
  const [coins, setCoins] = useState<string[]>([]);
  const [intervals, setIntervals] = useState<string[]>([]);
  const [coin, setCoin] = useState<string | null>(null);
  const [activeInterval, setActiveInterval] = useState('15m');
  const [data, setData] = useState<DashboardData>(emptyData);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');
  const [backtest, setBacktest] = useState<BacktestLoadState>(emptyBacktest);

  // Load the saved theme once, then keep <html data-theme> and localStorage in sync.
  useEffect(() => {
    const saved = localStorage.getItem('rb-theme');
    if (saved === 'light' || saved === 'dusk' || saved === 'dark') setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rb-theme', theme);
  }, [theme]);

  // Load the coin list, retrying until the monitor API is reachable.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function loadCoins() {
      try {
        const list = await getCoins();
        if (!alive || list.length === 0) return;
        setCoins(list);
        setCoin((current) => current ?? list[0]);
        setError(null);
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        if (alive) setError('Cannot reach monitor API');
      }
    }

    void loadCoins();
    timer = setInterval(loadCoins, 5_000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadIntervals() {
      try {
        const list = await getIntervals();
        if (!alive || list.length === 0) return;
        setIntervals(list);
        setActiveInterval((current) => list.includes(current) ? current : list[0]);
      } catch {
        if (alive) setIntervals(['15m']);
      }
    }

    void loadIntervals();
    return () => {
      alive = false;
    };
  }, []);

  // Poll dashboard data for the selected coin.
  useEffect(() => {
    if (!coin) return;
    let alive = true;
    setData(emptyData);

    async function load() {
      try {
        const next = await getDashboardData(coin!, activeInterval);
        if (!alive) return;
        setData(next);
        setError(null);
      } catch (caught) {
        if (!alive) return;
        setError(caught instanceof Error ? caught.message : 'API unavailable');
      }
    }

    void load();
    const interval = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [coin, activeInterval]);

  useEffect(() => {
    if (!coin) {
      setBacktest(emptyBacktest);
      return;
    }

    let alive = true;

    async function loadBacktest() {
      setBacktest((current) => ({ ...current, loading: true, error: null }));

      try {
        const [strategyCandles, dailyCandles, regimeCandles] = await Promise.all([
          getCandles(coin!, STRATEGY_INTERVAL, BACKTEST_HISTORY_LIMIT),
          getCandles(coin!, '1d', BACKTEST_HISTORY_LIMIT),
          getCandles(coin!, '1h', BACKTEST_HISTORY_LIMIT),
        ]);
        if (!alive) return;

        setBacktest({
          result: runBacktest(strategyCandles, dailyCandles, {
            coin: coin!,
            ...BACKTEST_OPTIONS,
          }, regimeCandles),
          loading: false,
          error: null,
        });
      } catch (caught) {
        if (!alive) return;
        setBacktest({
          result: null,
          loading: false,
          error: caught instanceof Error ? caught.message : 'Backtest unavailable',
        });
      }
    }

    void loadBacktest();
    const interval = setInterval(loadBacktest, BACKTEST_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [coin]);

  const latestClose = data.candles.at(-1)?.close ?? null;
  const price = data.status?.currentPrice ?? latestClose;

  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <img src="/rangeboss-logo.png" alt="RangeBoss" className="h-9 w-auto" />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ThemeSelector theme={theme} onSelect={setTheme} />
            <StatusPill healthy={Boolean(data.status?.socketHealthy)} />
            <Metric label="Price" value={price === null ? 'Waiting' : formatPrice(price)} />
            <Metric label="Last Candle" value={formatTimes(data.status?.lastCandleTime ?? null)} wide />
          </div>
        </div>
      </header>

      <CoinSelector coins={coins} active={coin} onSelect={setCoin} />

      <div className="mx-auto grid max-w-[1600px] gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <LevelStrip levels={data.levels} />
            <TimeframeSelector intervals={intervals} active={activeInterval} onSelect={setActiveInterval} />
            {error ? <span className="text-sm font-medium text-negative">{error}</span> : null}
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute left-3 top-3 z-10 text-sm text-muted">
              {coin ? `${displayCoin(coin)} perpetual` : ''}
            </div>
            <Chart
              key={`${coin ?? 'none'}:${activeInterval}`}
              candles={data.candles}
              levels={data.levels}
              interval={activeInterval}
              theme={theme}
            />
          </div>
          <BacktestPanel coin={coin} state={backtest} />
        </section>

        <aside className="min-w-0 rounded border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-base font-semibold">Signal Feed</h2>
            <span className="text-sm text-muted">{data.events.length}</span>
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            {data.events.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted">No events yet</div>
            ) : data.events.map((event) => (
              <EventRow key={`${event.id ?? event.candleCloseTime}-${event.type}-${event.levelName}`} event={event} />
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function CoinSelector({
  coins,
  active,
  onSelect,
}: {
  coins: string[];
  active: string | null;
  onSelect: (coin: string) => void;
}) {
  if (coins.length === 0) return null;

  return (
    <nav className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1600px] gap-2 overflow-x-auto px-5 py-3">
        {coins.map((c) => {
          const isActive = c === active;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onSelect(c)}
              className={[
                'shrink-0 rounded border px-3 py-1.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'border-accent bg-accent text-accentfg'
                  : 'border-line bg-surface2 text-ink hover:border-muted',
              ].join(' ')}
            >
              {displayCoin(c)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function TimeframeSelector({
  intervals,
  active,
  onSelect,
}: {
  intervals: string[];
  active: string;
  onSelect: (interval: string) => void;
}) {
  if (intervals.length === 0) return null;

  return (
    <div className="inline-flex rounded border border-line bg-surface2 p-1">
      {intervals.map((interval) => {
        const isActive = interval === active;
        return (
          <button
            key={interval}
            type="button"
            onClick={() => onSelect(interval)}
            className={[
              'min-w-12 rounded px-3 py-1.5 text-sm font-semibold transition-colors',
              isActive ? 'bg-accent text-accentfg' : 'text-ink hover:bg-bg',
            ].join(' ')}
          >
            {interval}
          </button>
        );
      })}
    </div>
  );
}

function ThemeSelector({ theme, onSelect }: { theme: Theme; onSelect: (theme: Theme) => void }) {
  const options: Array<[Theme, string]> = [['light', 'Light'], ['dusk', 'Dusk'], ['dark', 'Dark']];

  return (
    <div className="inline-flex rounded border border-line bg-surface2 p-1">
      {options.map(([value, label]) => {
        const isActive = value === theme;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            className={[
              'rounded px-2.5 py-1.5 text-sm font-semibold transition-colors',
              isActive ? 'bg-accent text-accentfg' : 'text-ink hover:bg-bg',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function StatusPill({ healthy }: { healthy: boolean }) {
  const Icon = healthy ? Wifi : WifiOff;

  return (
    <span className={[
      'inline-flex items-center gap-2 rounded border px-3 py-2 font-medium',
      healthy ? 'border-positive/30 bg-positive/10 text-positive' : 'border-negative/30 bg-negative/10 text-negative',
    ].join(' ')}>
      <Icon className="h-4 w-4" aria-hidden />
      {healthy ? 'Socket Live' : 'Socket Offline'}
    </span>
  );
}

function Metric({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={['rounded border border-line bg-surface2 px-3 py-2', wide ? 'min-w-[260px]' : 'min-w-[120px]'].join(' ')}>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="truncate font-semibold">{value}</div>
    </div>
  );
}

function LevelStrip({ levels }: { levels: Levels | null }) {
  const items = useMemo(() => levels ? [
    ['Range High', levels.rangeHigh, 'text-negative'],
    ['Swing High', levels.swingHigh, 'text-negative'],
    ['Range Low', levels.rangeLow, 'text-positive'],
    ['Swing Low', levels.swingLow, 'text-positive'],
  ] as const : [], [levels]);

  if (!levels) {
    return <div className="text-sm text-muted">Levels pending</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([label, value, color]) => (
        <div key={label} className="rounded border border-line bg-surface px-3 py-2 text-sm">
          <span className="mr-2 text-muted">{label}</span>
          <span className={`font-semibold ${color}`}>{value === null ? 'None' : formatPrice(value)}</span>
        </div>
      ))}
    </div>
  );
}

function BacktestPanel({ coin, state }: { coin: string | null; state: BacktestLoadState }) {
  const result = state.result;
  const summary = result?.summary;
  const outOfSample = result?.segments.outOfSample.summary;
  const trades = result?.trades.slice(-5).reverse() ?? [];

  return (
    <section className="mt-4 rounded border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Strategy Backtest</h2>
          <p className="mt-1 text-sm text-muted">
            {coin
              ? `${displayCoin(coin)} ${STRATEGY_INTERVAL} rules from first available candle`
              : 'Select a market to run the strategy history'}
          </p>
        </div>
        <div className="rounded border border-line bg-surface2 px-3 py-2 text-right text-sm">
          <div className="text-xs uppercase text-muted">Window</div>
          <div className="font-semibold">
            {result?.firstCandleTime ? `${formatShortDate(result.firstCandleTime)} - ${formatShortDate(result.lastCandleTime)}` : 'Waiting'}
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
          <BacktestMetric label="Regime" value={result?.currentRegime?.ready ? result.currentRegime.regime : 'WARMUP'} />
          <BacktestMetric label="ADX (1h)" value={result?.currentRegime?.ready ? result.currentRegime.adx.toFixed(1) : '--'} />
          <BacktestMetric label="RSI (1h)" value={result?.currentRegime?.ready ? result.currentRegime.rsi.toFixed(1) : '--'} />
          <BacktestMetric label="Signals" value={summary ? String(summary.totalTrades) : '--'} />
          <BacktestMetric label="Win Rate" value={summary ? formatPercent(summary.winRate) : '--'} tone={summary && summary.winRate >= 0.5 ? 'positive' : undefined} />
          <BacktestMetric label="Net R" value={summary ? formatR(summary.netR) : '--'} tone={summary && summary.netR >= 0 ? 'positive' : 'negative'} />
          <BacktestMetric label="Profit Factor" value={summary ? formatProfitFactor(summary.profitFactor) : '--'} tone={summary && summary.profitFactor >= 1 ? 'positive' : 'negative'} />
          <BacktestMetric label="Max Drawdown" value={summary ? formatR(-summary.maxDrawdownR) : '--'} tone="negative" />
          <BacktestMetric label="Holdout Net R" value={outOfSample ? formatR(outOfSample.netR) : '--'} tone={outOfSample && outOfSample.netR >= 0 ? 'positive' : 'negative'} />
          <BacktestMetric label="Exposure" value={result ? formatPercent(result.exposurePct) : '--'} />
          <BacktestMetric label="Buy & Hold" value={result ? formatPercent(result.buyHoldReturnPct) : '--'} tone={result && result.buyHoldReturnPct >= 0 ? 'positive' : 'negative'} />
        </div>

        <div className="min-w-0 rounded border border-line bg-surface2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm">
            <span className="font-semibold">Recent simulated trades</span>
            <span className="text-muted">
              {result ? `${result.touchEvents} touches / ${result.breakEvents} breaks / ${result.strategyCandles} candles` : 'No run yet'}
            </span>
          </div>
          {state.error ? (
            <div className="px-3 py-5 text-sm text-negative">{state.error}</div>
          ) : state.loading && !result ? (
            <div className="px-3 py-5 text-sm text-muted">Loading backtest...</div>
          ) : trades.length === 0 ? (
            <div className="px-3 py-5 text-sm text-muted">No confirmed signals in the available history.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 font-medium">Strategy</th>
                    <th className="px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2 font-medium">Exit</th>
                    <th className="px-3 py-2 font-medium">R</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <BacktestTradeRow key={`${trade.signalTime}-${trade.direction}-${trade.levelName}`} trade={trade} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
        <BacktestBreakdown label="Range reversion" trades={result?.byStrategy.RANGE_REVERSION.totalTrades} netR={result?.byStrategy.RANGE_REVERSION.netR} />
        <BacktestBreakdown label="Trend momentum" trades={result?.byStrategy.TREND_MOMENTUM.totalTrades} netR={result?.byStrategy.TREND_MOMENTUM.netR} />
        <BacktestBreakdown label="First 70%" trades={result?.segments.inSample.summary.totalTrades} netR={result?.segments.inSample.summary.netR} />
        <BacktestBreakdown label="Last 30%" trades={result?.segments.outOfSample.summary.totalTrades} netR={result?.segments.outOfSample.summary.netR} />
      </div>
    </section>
  );
}

function BacktestBreakdown({ label, trades, netR }: { label: string; trades?: number; netR?: number }) {
  const tone = netR === undefined ? 'text-muted' : netR >= 0 ? 'text-positive' : 'text-negative';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm sm:border-r">
      <span className="font-medium">{label}</span>
      <span className={tone}>{trades ?? '--'} trades / {netR === undefined ? '--' : formatR(netR)}</span>
    </div>
  );
}

function BacktestMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  const toneClass = tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-ink';

  return (
    <div className="rounded border border-line bg-surface2 px-3 py-2">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={`truncate text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function BacktestTradeRow({ trade }: { trade: BacktestTrade }) {
  const isWin = trade.rMultiple > 0;

  return (
    <tr className="border-t border-line">
      <td className="whitespace-nowrap px-3 py-2 text-muted">{formatShortDate(trade.signalTime)}</td>
      <td className={['px-3 py-2 font-semibold', trade.direction === 'LONG' ? 'text-positive' : 'text-negative'].join(' ')}>
        {trade.direction}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
        {trade.strategy === 'TREND_MOMENTUM' ? 'Momentum' : 'Range'}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{formatPrice(trade.entry)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatPrice(trade.exitPrice)}
        <span className="ml-1 text-xs text-muted">{trade.exitReason}</span>
      </td>
      <td className={['whitespace-nowrap px-3 py-2 font-semibold', isWin ? 'text-positive' : 'text-negative'].join(' ')}>
        {formatR(trade.rMultiple)}
      </td>
    </tr>
  );
}

function EventRow({ event }: { event: MarketEvent }) {
  const isSignal = event.type === 'CONFIRMED_SIGNAL';
  const accent = event.side === 'SUPPORT' ? 'border-l-positive' : 'border-l-negative';
  const rr = event.entry && event.stop && event.target
    ? Math.abs(event.target - event.entry) / Math.abs(event.entry - event.stop)
    : null;

  return (
    <article className={`border-b border-line border-l-4 ${accent} px-4 py-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{isSignal ? `${event.direction} Signal` : titleCase(event.type)}</div>
          <div className="text-sm text-muted">{event.levelName} at {formatPrice(event.levelPrice)}</div>
          {isSignal && event.strategy ? (
            <div className="mt-1 text-xs uppercase text-muted">{event.strategy.replace('_', ' ')} / {event.regime}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {formatUtcDateTime(event.candleCloseTime)}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <Value label="Close" value={formatPrice(event.price)} />
        <Value label="Side" value={event.side} />
        {isSignal ? (
          <>
            <Value label="Entry" value={formatPrice(event.entry)} />
            <Value label="Stop" value={formatPrice(event.stop)} />
            <Value label="Target" value={formatPrice(event.target)} />
            <Value label="Score" value={`${event.score ?? 0}`} />
            <Value label="R:R" value={rr === null ? 'n/a' : rr.toFixed(2)} />
          </>
        ) : null}
      </div>
    </article>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

function formatPrice(value: number | undefined) {
  if (value === undefined) return 'n/a';
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatUtcDateTime(timestamp: number) {
  // "06-04 14:15" — date + time so prior-day events in the feed are distinguishable.
  return new Date(timestamp).toISOString().slice(5, 16).replace('T', ' ');
}

function formatShortDate(timestamp: number | null) {
  if (!timestamp) return 'Waiting';
  return new Date(timestamp).toISOString().slice(5, 16).replace('T', ' ');
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatR(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

function formatProfitFactor(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : 'INF';
}

function formatTimes(timestamp: number | null) {
  if (!timestamp) return 'Waiting';

  const utc = new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16);
  const uk = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);

  return `${utc} UTC / ${uk} UK`;
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}
