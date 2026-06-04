import { config } from '../../config';
import type { Store } from './store';

export type MonitorStatus = {
  coins: string[];
  socketHealthy: boolean;
  prices: Record<string, number | null>;
};

export function startApi(store: Store, status: MonitorStatus) {
  const resolveCoin = (url: URL): string => {
    const requested = url.searchParams.get('coin');
    if (requested) {
      const match = status.coins.find((coin) => coin.toLowerCase() === requested.toLowerCase());
      if (match) return match;
    }
    return status.coins[0];
  };

  const server = Bun.serve({
    port: config.apiPort,
    fetch(request) {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return json({});
      }

      if (url.pathname === '/') {
        return html(apiIndex(status));
      }

      if (url.pathname === '/api/coins') {
        return json(status.coins);
      }

      if (url.pathname === '/api/levels') {
        return json(store.getLatestLevels(resolveCoin(url)));
      }

      if (url.pathname === '/api/candles') {
        const limit = Number(url.searchParams.get('limit') ?? 300);
        return json(store.getRecentCandles(resolveCoin(url), config.candleInterval, clampLimit(limit, 1, 1000)));
      }

      if (url.pathname === '/api/events') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return json(store.getRecentEvents(resolveCoin(url), clampLimit(limit, 1, 200)));
      }

      if (url.pathname === '/api/status') {
        const coin = resolveCoin(url);
        return json({
          coin,
          coins: status.coins,
          lastCandleTime: store.getLastCandleTime(coin, config.candleInterval),
          socketHealthy: status.socketHealthy,
          currentPrice: status.prices[coin] ?? null,
        });
      }

      return json({ error: 'Not found' }, 404);
    },
  });

  console.log(`Monitor API listening on http://localhost:${server.port}`);
  return server;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function apiIndex(status: MonitorStatus) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hyperliquid Monitor API</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #efeee9;
        color: #15171a;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      main {
        width: min(720px, calc(100vw - 40px));
        border: 1px solid #dedbd2;
        background: #fbfaf6;
        padding: 28px;
      }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 20px; color: #62666a; }
      a {
        color: #15171a;
        font-weight: 650;
        text-decoration-thickness: 2px;
        text-underline-offset: 3px;
      }
      ul { margin: 18px 0 0; padding-left: 20px; line-height: 1.9; }
      code {
        background: #efeee9;
        border: 1px solid #dedbd2;
        padding: 2px 6px;
      }
      .status {
        display: inline-block;
        margin-top: 4px;
        padding: 6px 10px;
        border: 1px solid ${status.socketHealthy ? '#20885f' : '#b94040'};
        color: ${status.socketHealthy ? '#20885f' : '#b94040'};
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Hyperliquid Monitor API</h1>
      <p>This port serves JSON for the dashboard. Open the dashboard at <a href="http://localhost:3000">localhost:3000</a>.</p>
      <div class="status">socket ${status.socketHealthy ? 'healthy' : 'offline'} - ${status.coins.length} coins: ${status.coins.join(', ')}</div>
      <ul>
        <li><a href="/api/coins"><code>/api/coins</code></a></li>
        <li><a href="/api/status?coin=${encodeURIComponent(status.coins[0] ?? '')}"><code>/api/status?coin=…</code></a></li>
        <li><a href="/api/levels?coin=${encodeURIComponent(status.coins[0] ?? '')}"><code>/api/levels?coin=…</code></a></li>
        <li><a href="/api/candles?coin=${encodeURIComponent(status.coins[0] ?? '')}&limit=300"><code>/api/candles?coin=…&limit=300</code></a></li>
        <li><a href="/api/events?coin=${encodeURIComponent(status.coins[0] ?? '')}&limit=50"><code>/api/events?coin=…&limit=50</code></a></li>
      </ul>
    </main>
  </body>
</html>`;
}

function clampLimit(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
