'use client';

import type { PortfolioClosedTrade } from '../../core/portfolio';
import { displayCoin } from '../lib/api';

export default function TradeLedger({
  trades,
  title,
  description,
  showMarket = true,
}: {
  trades: PortfolioClosedTrade[];
  title: string;
  description: string;
  showMarket?: boolean;
}) {
  const rows = [...trades].sort((a, b) => b.exitTime - a.exitTime);

  return (
    <section className="min-w-0 border border-line bg-surface2">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 py-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        <span className="text-xs font-semibold text-muted">{rows.length} executed trades</span>
      </header>
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-sm text-muted">No executed portfolio trades in the available history.</div>
      ) : (
        <div className="max-h-[620px] overflow-auto">
          <table className="min-w-[1180px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-surface2 text-xs uppercase text-muted">
              <tr>
                {showMarket ? <th className="px-3 py-2 font-medium">Market</th> : null}
                <th className="px-3 py-2 font-medium">Side / strategy</th>
                <th className="px-3 py-2 font-medium">Entry</th>
                <th className="px-3 py-2 font-medium">Exit</th>
                <th className="px-3 py-2 font-medium">Margin allocated</th>
                <th className="px-3 py-2 font-medium">Notional</th>
                <th className="px-3 py-2 font-medium">P&amp;L</th>
                <th className="px-3 py-2 font-medium">Return on margin</th>
                <th className="px-3 py-2 font-medium">Exit type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trade) => (
                <tr key={`${trade.coin}-${trade.entryTime}-${trade.exitTime}`} className="border-t border-line">
                  {showMarket ? <td className="whitespace-nowrap px-3 py-2 font-semibold">{displayCoin(trade.coin)}</td> : null}
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className={trade.direction === 'LONG' ? 'font-semibold text-positive' : 'font-semibold text-negative'}>
                      {trade.direction}
                    </div>
                    <div className="text-xs text-muted">{formatStrategy(trade.strategy)} · {trade.regime}</div>
                  </td>
                  <LedgerPoint time={trade.entryTime} price={trade.entry} />
                  <LedgerPoint time={trade.exitTime} price={trade.exitPrice} />
                  <td className="whitespace-nowrap px-3 py-2">
                    <div>{formatUsd(trade.margin)}</div>
                    <div className="text-xs text-muted">{formatUnsignedPercent(trade.allocationPct)} at entry</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatUsd(trade.notional)}</td>
                  <td className={trade.pnl >= 0 ? 'whitespace-nowrap px-3 py-2 font-semibold text-positive' : 'whitespace-nowrap px-3 py-2 font-semibold text-negative'}>
                    {formatSignedUsd(trade.pnl)}
                  </td>
                  <td className={trade.returnOnMargin >= 0 ? 'whitespace-nowrap px-3 py-2 text-positive' : 'whitespace-nowrap px-3 py-2 text-negative'}>
                    {formatPercent(trade.returnOnMargin)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={exitTone(trade.exitReason)}>{trade.exitReason}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LedgerPoint({ time, price }: { time: number; price: number }) {
  return (
    <td className="whitespace-nowrap px-3 py-2">
      <div>{formatPrice(price)}</div>
      <div className="text-xs text-muted">{formatDateTime(time)}</div>
    </td>
  );
}

function exitTone(reason: PortfolioClosedTrade['exitReason']) {
  if (reason === 'TARGET') return 'font-semibold text-positive';
  if (reason === 'LIQUIDATION') return 'font-semibold text-negative';
  return 'font-semibold text-warning';
}

function formatStrategy(strategy: PortfolioClosedTrade['strategy']) {
  return strategy === 'TREND_MOMENTUM' ? 'Momentum' : 'Range';
}

function formatPrice(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatUsd(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatSignedUsd(value: number) {
  return `${value > 0 ? '+' : ''}${formatUsd(value)}`;
}

function formatPercent(value: number) {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatUnsignedPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16);
}
