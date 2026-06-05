'use client';

import { Clock, Palette, Wifi, WifiOff } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import {
  displayCoin,
  getCoins,
  getDashboardData,
  getIntervals,
  getLevelsHistory,
  type Candle,
  type Levels,
  type MarketEvent,
  type Status,
  type Trend,
} from '../lib/api';

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

// Bump this when you ship a change so you can tell which version is live.
const APP_VERSION = 'v4.0.0';

export default function Page() {
  const [coins, setCoins] = useState<string[]>([]);
  const [intervals, setIntervals] = useState<string[]>([]);
  const [coin, setCoin] = useState<string | null>(null);
  const [activeInterval, setActiveInterval] = useState('15m');
  const [data, setData] = useState<DashboardData>(emptyData);
  const [showHistory, setShowHistory] = useState(false);
  const [levelsHistory, setLevelsHistory] = useState<Levels[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');

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

  const loadedWindow = useMemo(() => {
    const first = data.candles[0];
    const last = data.candles.at(-1);
    if (!first || !last) return null;
    return { from: first.openTime, to: last.closeTime };
  }, [data.candles]);

  useEffect(() => {
    if (!showHistory || !coin || !loadedWindow) {
      setLevelsHistory([]);
      return;
    }

    let alive = true;

    async function loadHistory() {
      try {
        const history = await getLevelsHistory(coin!, loadedWindow!.from, loadedWindow!.to);
        if (alive) setLevelsHistory(history);
      } catch (caught) {
        if (!alive) return;
        setLevelsHistory([]);
        setError(caught instanceof Error ? caught.message : 'Level history unavailable');
      }
    }

    void loadHistory();
    return () => {
      alive = false;
    };
  }, [showHistory, coin, activeInterval, loadedWindow?.from, loadedWindow?.to]);

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
            <ThemeMenu theme={theme} onSelect={setTheme} />
            <StatusPill healthy={Boolean(data.status?.socketHealthy)} />
            <Metric label="Hyperliquid" value={coin ? `${displayCoin(coin)} perpetual` : 'Loading…'} />
            <Metric label="Price" value={price === null ? 'Waiting' : formatPrice(price)} />
            <Metric label="Last Candle" value={formatTimes(data.status?.lastCandleTime ?? null)} wide />
          </div>
        </div>
      </header>

      <CoinSelector coins={coins} active={coin} onSelect={setCoin} />

      <div className="mx-auto grid max-w-[1600px] gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <TrendBadge trend={data.levels?.trend ?? null} />
              <LevelStrip levels={data.levels} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <HistoryToggle active={showHistory} onToggle={() => setShowHistory((value) => !value)} />
              <TimeframeSelector intervals={intervals} active={activeInterval} onSelect={setActiveInterval} />
            </div>
            {error ? <span className="text-sm font-medium text-negative">{error}</span> : null}
          </div>
          <Chart
            key={`${coin ?? 'none'}:${activeInterval}`}
            candles={data.candles}
            levels={data.levels}
            levelsHistory={levelsHistory}
            showHistory={showHistory}
            interval={activeInterval}
            theme={theme}
          />
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

      <footer className="px-5 py-4 text-center text-xs text-muted">
        RangeBoss {APP_VERSION}
      </footer>
    </main>
  );
}

function HistoryToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={[
        'rounded border px-3 py-2 text-sm font-semibold transition-colors',
        active ? 'border-accent bg-accent text-accentfg' : 'border-line bg-surface2 text-ink hover:bg-bg',
      ].join(' ')}
    >
      History
    </button>
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

function ThemeMenu({ theme, onSelect }: { theme: Theme; onSelect: (theme: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const options: Array<[Theme, string]> = [['light', 'Light'], ['dusk', 'Dusk'], ['dark', 'Dark']];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded border border-line bg-surface2 px-3 py-2 font-medium text-ink"
      >
        <Palette className="h-4 w-4" aria-hidden />
        Theme
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded border border-line bg-surface2 shadow-lg">
            {options.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  onSelect(value);
                  setOpen(false);
                }}
                className={[
                  'block w-full px-3 py-2 text-left text-sm font-medium transition-colors',
                  value === theme ? 'bg-accent text-accentfg' : 'text-ink hover:bg-bg',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : null}
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

function TrendBadge({ trend }: { trend: Trend | null }) {
  if (!trend) {
    return <div className="rounded border border-line bg-surface px-3 py-2 text-sm text-muted">Trend pending</div>;
  }

  const classes: Record<Trend, string> = {
    UP: 'border-positive/30 bg-positive/10 text-positive',
    DOWN: 'border-negative/30 bg-negative/10 text-negative',
    SIDE: 'border-line bg-surface2 text-muted',
  };

  return (
    <div className={`rounded border px-3 py-2 text-sm font-semibold ${classes[trend]}`}>
      {trend}
    </div>
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
            <Value label="Trend" value={event.trend ?? 'n/a'} />
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
