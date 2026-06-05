'use client';

import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import type { Candle, Levels, MarketEvent } from '../lib/api';

type Props = {
  candles: Candle[];
  levels: Levels | null;
  events: MarketEvent[];
  interval: string;
};

export default function Chart({ candles, levels, events, interval }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const didInitialFitRef = useRef(false);

  const chartData = useMemo<CandlestickData[]>(() => candles.map((candle) => ({
    time: toChartTime(candle.openTime),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  })), [candles]);

  const intervalMs = useMemo(() => intervalToMs(interval), [interval]);

  const markers = useMemo<SeriesMarker<Time>[]>(() => events.map((event) => ({
    time: toChartTime(containingBarOpenTime(event.candleCloseTime, intervalMs)),
    position: event.side === 'SUPPORT' ? 'belowBar' : 'aboveBar',
    color: event.type === 'CONFIRMED_SIGNAL'
      ? '#b57b20'
      : event.side === 'SUPPORT'
        ? '#20885f'
        : '#b94040',
    shape: event.type === 'CONFIRMED_SIGNAL'
      ? event.direction === 'LONG' ? 'arrowUp' : 'arrowDown'
      : 'circle',
    text: event.type === 'CONFIRMED_SIGNAL' ? `${event.direction} ${event.score ?? 0}` : event.levelName,
  }))
    // lightweight-charts requires markers in ascending time order; events arrive newest-first.
    .sort((a, b) => (a.time as number) - (b.time as number)), [events, intervalMs]);

  useEffect(() => {
    didInitialFitRef.current = false;
  }, [interval]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      height: 540,
      layout: {
        background: { type: ColorType.Solid, color: '#fbfaf6' },
        textColor: '#373a3d',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: '#ece8dc' },
        horzLines: { color: '#ece8dc' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      rightPriceScale: { borderColor: '#d6d1c5' },
      timeScale: {
        borderColor: '#d6d1c5',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#20885f',
      downColor: '#b94040',
      borderVisible: false,
      wickUpColor: '#20885f',
      wickDownColor: '#b94040',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const resize = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    resize.observe(containerRef.current);

    return () => {
      resize.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    series.setData(chartData);
    series.setMarkers(markers);
    priceLinesRef.current.forEach((line) => series.removePriceLine(line));
    priceLinesRef.current = [];

    if (levels) {
      const lines = [
        { price: levels.rangeHigh, color: '#b94040', title: 'Range High', style: LineStyle.Solid },
        levels.swingHigh === null ? null : { price: levels.swingHigh, color: '#b94040', title: 'Swing High', style: LineStyle.Dashed },
        { price: levels.rangeLow, color: '#20885f', title: 'Range Low', style: LineStyle.Solid },
        levels.swingLow === null ? null : { price: levels.swingLow, color: '#20885f', title: 'Swing Low', style: LineStyle.Dashed },
      ];

      for (const line of lines) {
        if (!line) continue;
        const priceLine = series.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: 2,
          lineStyle: line.style,
          axisLabelVisible: true,
          title: line.title,
        });
        priceLinesRef.current.push(priceLine);
      }
    }

    if (!didInitialFitRef.current && chartData.length > 0) {
      chartRef.current?.timeScale().fitContent();
      didInitialFitRef.current = true;
    }
  }, [chartData, levels, markers]);

  return <div ref={containerRef} className="h-[540px] w-full overflow-hidden rounded border border-line bg-[#fbfaf6]" />;
}

function toChartTime(timestamp: number): Time {
  return Math.floor(timestamp / 1000) as Time;
}

function containingBarOpenTime(timestamp: number, intervalMs: number): number {
  return Math.floor((timestamp - 1) / intervalMs) * intervalMs;
}

function intervalToMs(interval: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(interval);
  if (!match) return 15 * 60 * 1000;

  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}
