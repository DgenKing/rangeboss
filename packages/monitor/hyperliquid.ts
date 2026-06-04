import type { Candle } from '../core/types';

type RawCandle = {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string | number;
  c: string | number;
  h: string | number;
  l: string | number;
  v: string | number;
  n: number;
};

type SocketHandlers = {
  onClosedCandle: (coin: string, candle: Candle) => void | Promise<void>;
  onCurrentPrice: (coin: string, price: number) => void;
  onHealth: (healthy: boolean) => void;
  onLog?: (message: string) => void;
};

export async function fetchCandles(params: {
  restUrl: string;
  coin: string;
  interval: string;
  startTime: number;
  endTime: number;
}): Promise<Candle[]> {
  const response = await fetch(params.restUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: {
        coin: params.coin,
        interval: params.interval,
        startTime: params.startTime,
        endTime: params.endTime,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid candleSnapshot failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected candleSnapshot payload: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  return payload.map(parseCandle).sort((a, b) => a.openTime - b.openTime);
}

export class HyperliquidSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: Timer | null = null;
  private staleTimer: Timer | null = null;
  private reconnectAttempt = 0;
  private lastMessageAt = 0;
  private liveCandles = new Map<string, Candle>();
  private processed = new Set<string>();

  constructor(
    private readonly params: {
      wsUrl: string;
      coins: string[];
      interval: string;
      staleSocketSeconds: number;
    },
    private readonly handlers: SocketHandlers,
  ) {}

  start() {
    this.connect();
    this.staleTimer = setInterval(() => this.reconnectIfStale(), 5_000);
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.ws?.close();
  }

  isHealthy() {
    return Date.now() - this.lastMessageAt <= this.params.staleSocketSeconds * 1000;
  }

  private connect() {
    this.handlers.onLog?.(`Opening Hyperliquid WebSocket for ${this.params.coins.length} coins`);
    this.ws = new WebSocket(this.params.wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      this.handlers.onHealth(true);
      this.subscribe();
    };

    this.ws.onmessage = (message) => {
      this.lastMessageAt = Date.now();
      this.handlers.onHealth(true);
      this.handleMessage(message.data);
    };

    this.ws.onerror = () => {
      this.handlers.onHealth(false);
    };

    this.ws.onclose = () => {
      this.handlers.onHealth(false);
      this.scheduleReconnect();
    };
  }

  private subscribe() {
    for (const coin of this.params.coins) {
      this.send({
        method: 'subscribe',
        subscription: {
          type: 'candle',
          coin,
          interval: this.params.interval,
        },
      });
    }
    this.send({
      method: 'subscribe',
      subscription: { type: 'allMids' },
    });
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleMessage(data: string | ArrayBufferLike | Blob) {
    if (typeof data !== 'string') return;

    const message = JSON.parse(data) as {
      channel?: string;
      data?: unknown;
    };

    if (message.channel === 'candle') {
      const raw = message.data as RawCandle;
      this.handleCandle(raw.s, parseCandle(raw));
      return;
    }

    if (message.channel === 'allMids') {
      const mids = (message.data as { mids?: Record<string, string | number> })?.mids;
      if (!mids) return;
      for (const coin of this.params.coins) {
        const raw = mids[coin];
        if (raw !== undefined) this.handlers.onCurrentPrice(coin, toNumber(raw));
      }
    }
  }

  private handleCandle(coin: string, candle: Candle) {
    this.handlers.onCurrentPrice(coin, candle.close);

    const live = this.liveCandles.get(coin);
    if (live && candle.openTime > live.openTime) {
      this.emitClosed(coin, live);
      this.liveCandles.set(coin, candle);
      return;
    }

    this.liveCandles.set(coin, candle);

    if (Date.now() >= candle.closeTime) {
      this.emitClosed(coin, candle);
    }
  }

  private emitClosed(coin: string, candle: Candle) {
    const key = `${coin}:${candle.openTime}`;
    if (this.processed.has(key)) return;
    this.processed.add(key);
    void this.handlers.onClosedCandle(coin, candle);

    if (this.processed.size > 5_000) {
      this.processed = new Set([...this.processed].slice(-2_500));
    }
  }

  private reconnectIfStale() {
    if (this.ws && Date.now() - this.lastMessageAt > this.params.staleSocketSeconds * 1000) {
      this.handlers.onLog?.('Hyperliquid WebSocket is stale; forcing reconnect');
      this.ws.close();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export function parseCandle(raw: RawCandle): Candle {
  return {
    openTime: raw.t,
    closeTime: raw.T,
    open: toNumber(raw.o),
    high: toNumber(raw.h),
    low: toNumber(raw.l),
    close: toNumber(raw.c),
    volume: toNumber(raw.v),
  };
}

function toNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric Hyperliquid value, received ${value}`);
  }

  return parsed;
}
