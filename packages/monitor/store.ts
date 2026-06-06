import { Database } from 'bun:sqlite';
import type { Candle, Levels, MarketEvent } from '../core/types';

type DbEventRow = Omit<MarketEvent, 'notified'> & { notified: 0 | 1 };

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  saveCandles(coin: string, interval: string, candles: Candle[]) {
    const stmt = this.db.prepare(`
      INSERT INTO candles
        (coin, interval, openTime, closeTime, open, high, low, close, volume)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(coin, interval, openTime) DO UPDATE SET
        closeTime = excluded.closeTime,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume
    `);

    const tx = this.db.transaction((rows: Candle[]) => {
      for (const candle of rows) {
        stmt.run(
          coin,
          interval,
          candle.openTime,
          candle.closeTime,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
        );
      }
    });

    tx(candles);
  }

  saveLevels(levels: Levels) {
    this.db.prepare(`
      INSERT INTO levels
        (coin, forUtcDay, computedAt, rangeHigh, rangeLow, swingHigh, swingLow)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(coin, forUtcDay) DO UPDATE SET
        computedAt = excluded.computedAt,
        rangeHigh = excluded.rangeHigh,
        rangeLow = excluded.rangeLow,
        swingHigh = excluded.swingHigh,
        swingLow = excluded.swingLow
    `).run(
      levels.coin,
      levels.forUtcDay,
      levels.computedAt,
      levels.rangeHigh,
      levels.rangeLow,
      levels.swingHigh,
      levels.swingLow,
    );
  }

  saveEvents(events: MarketEvent[]): MarketEvent[] {
    const stmt = this.db.prepare(`
      INSERT INTO events
        (type, coin, side, levelName, levelPrice, candleCloseTime, price,
         direction, entry, stop, target, score, strategy, regime, notified, createdAt)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);

    return events.map((event) => {
      const row = stmt.get(
        event.type,
        event.coin,
        event.side,
        event.levelName,
        event.levelPrice,
        event.candleCloseTime,
        event.price,
        event.direction ?? null,
        event.entry ?? null,
        event.stop ?? null,
        event.target ?? null,
        event.score ?? null,
        event.strategy ?? null,
        event.regime ?? null,
        event.notified ? 1 : 0,
        Date.now(),
      ) as { id: number };

      return { ...event, id: row.id };
    });
  }

  markNotified(id: number) {
    this.db.prepare('UPDATE events SET notified = 1 WHERE id = ?').run(id);
  }

  getRecentCandles(coin: string, interval: string, limit: number): Candle[] {
    const rows = this.db.query(`
      SELECT openTime, closeTime, open, high, low, close, volume
      FROM candles
      WHERE coin = ? AND interval = ?
      ORDER BY openTime DESC
      LIMIT ?
    `).all(coin, interval, limit) as Candle[];

    return rows.reverse();
  }

  getLatestLevels(coin: string): Levels | null {
    return this.db.query(`
      SELECT coin, computedAt, forUtcDay, rangeHigh, rangeLow, swingHigh, swingLow
      FROM levels
      WHERE coin = ?
      ORDER BY computedAt DESC
      LIMIT 1
    `).get(coin) as Levels | null;
  }

  getRecentEvents(coin: string, limit: number): MarketEvent[] {
    const rows = this.db.query(`
      SELECT id, type, coin, side, levelName, levelPrice, candleCloseTime, price,
             direction, entry, stop, target, score, strategy, regime, notified
      FROM events
      WHERE coin = ?
      ORDER BY candleCloseTime DESC, id DESC
      LIMIT ?
    `).all(coin, limit) as DbEventRow[];

    return rows.map((row) => ({ ...row, notified: Boolean(row.notified) }));
  }

  getLastCandleTime(coin: string, interval: string): number | null {
    const row = this.db.query(`
      SELECT closeTime
      FROM candles
      WHERE coin = ? AND interval = ?
      ORDER BY openTime DESC
      LIMIT 1
    `).get(coin, interval) as { closeTime: number } | null;

    return row?.closeTime ?? null;
  }

  countCandles(coin: string, interval: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) AS count
      FROM candles
      WHERE coin = ? AND interval = ?
    `).get(coin, interval) as { count: number } | null;

    return row?.count ?? 0;
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candles (
        coin TEXT,
        interval TEXT DEFAULT '15m',
        openTime INTEGER,
        closeTime INTEGER,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume REAL,
        PRIMARY KEY (coin, interval, openTime)
      );

      CREATE TABLE IF NOT EXISTS levels (
        coin TEXT,
        forUtcDay TEXT,
        computedAt INTEGER,
        rangeHigh REAL,
        rangeLow REAL,
        swingHigh REAL,
        swingLow REAL,
        PRIMARY KEY (coin, forUtcDay)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        coin TEXT,
        side TEXT,
        levelName TEXT,
        levelPrice REAL,
        candleCloseTime INTEGER,
        price REAL,
        direction TEXT,
        entry REAL,
        stop REAL,
        target REAL,
        score INTEGER,
        strategy TEXT,
        regime TEXT,
        notified INTEGER DEFAULT 0,
        createdAt INTEGER
      );

      DELETE FROM candles WHERE coin IS NULL OR interval IS NULL OR openTime IS NULL;
      DELETE FROM levels WHERE coin IS NULL OR forUtcDay IS NULL;
      DELETE FROM events WHERE coin IS NULL;
    `);

    const eventColumns = this.db.query('PRAGMA table_info(events)').all() as Array<{ name: string }>;
    if (!eventColumns.some((column) => column.name === 'strategy')) {
      this.db.exec('ALTER TABLE events ADD COLUMN strategy TEXT;');
    }
    if (!eventColumns.some((column) => column.name === 'regime')) {
      this.db.exec('ALTER TABLE events ADD COLUMN regime TEXT;');
    }
  }
}
