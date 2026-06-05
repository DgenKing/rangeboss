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
  type Time,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import type { Candle, Levels } from '../lib/api';

type Props = {
  candles: Candle[];
  levels: Levels | null;
  interval: string;
  theme: string;
};

const CHART_THEME: Record<string, { bg: string; text: string; grid: string; border: string }> = {
  light: { bg: '#fbfaf6', text: '#373a3d', grid: '#ece8dc', border: '#d6d1c5' },
  dusk: { bg: '#343a47', text: '#ced3dd', grid: '#3e4552', border: '#4a5160' },
  dark: { bg: '#16181d', text: '#c4c8ce', grid: '#232730', border: '#2f343d' },
};

export default function Chart({ candles, levels, interval, theme }: Props) {
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

  useEffect(() => {
    didInitialFitRef.current = false;
  }, [interval]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const palette = CHART_THEME[theme] ?? CHART_THEME.light;
    const chart = createChart(containerRef.current, {
      height: 540,
      layout: {
        background: { type: ColorType.Solid, color: palette.bg },
        textColor: palette.text,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
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
      rightPriceScale: { borderColor: palette.border },
      timeScale: {
        borderColor: palette.border,
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

  // Re-tint the chart when the theme changes (the chart is created once).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const palette = CHART_THEME[theme] ?? CHART_THEME.light;
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: palette.bg }, textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    });
  }, [theme]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    series.setData(chartData);
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
  }, [chartData, levels]);

  return <div ref={containerRef} className="h-[540px] w-full overflow-hidden rounded border border-line bg-surface" />;
}

function toChartTime(timestamp: number): Time {
  return Math.floor(timestamp / 1000) as Time;
}
