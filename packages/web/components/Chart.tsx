'use client';

import {
  ColorType,
  CrosshairMode,
  LineStyle,
  LineType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import type { Candle, Levels } from '../lib/api';

type Props = {
  candles: Candle[];
  levels: Levels | null;
  levelsHistory: Levels[];
  showHistory: boolean;
  interval: string;
  theme: string;
};

type LevelKey = 'rangeHigh' | 'swingHigh' | 'rangeLow' | 'swingLow';
type HistoryPoint = LineData<Time> | WhitespaceData<Time>;

const CHART_THEME: Record<string, { bg: string; text: string; grid: string; border: string }> = {
  light: { bg: '#fbfaf6', text: '#373a3d', grid: '#ece8dc', border: '#d6d1c5' },
  dusk: { bg: '#343a47', text: '#ced3dd', grid: '#3e4552', border: '#4a5160' },
  dark: { bg: '#16181d', text: '#c4c8ce', grid: '#232730', border: '#2f343d' },
};

const LEVEL_STYLES: Record<LevelKey, { color: string; title: string; style: LineStyle }> = {
  rangeHigh: { color: '#b94040', title: 'Range High', style: LineStyle.Solid },
  swingHigh: { color: '#b94040', title: 'Swing High', style: LineStyle.Dashed },
  rangeLow: { color: '#20885f', title: 'Range Low', style: LineStyle.Solid },
  swingLow: { color: '#20885f', title: 'Swing Low', style: LineStyle.Dashed },
};

export default function Chart({ candles, levels, levelsHistory, showHistory, interval, theme }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const historySeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
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
      // chart.remove() disposes all series/price-lines; drop the stale refs so the
      // next effect run doesn't try to remove them from a different chart instance
      // (React Strict Mode in dev recreates the chart, which triggered the crash).
      priceLinesRef.current = [];
      historySeriesRef.current = [];
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
    historySeriesRef.current.forEach((historySeries) => chartRef.current?.removeSeries(historySeries));
    historySeriesRef.current = [];

    if (levels && !showHistory) {
      const lines: Array<{ price: number; color: string; title: string; style: LineStyle } | null> = [
        { price: levels.rangeHigh, ...LEVEL_STYLES.rangeHigh },
        levels.swingHigh === null ? null : { price: levels.swingHigh, ...LEVEL_STYLES.swingHigh },
        { price: levels.rangeLow, ...LEVEL_STYLES.rangeLow },
        levels.swingLow === null ? null : { price: levels.swingLow, ...LEVEL_STYLES.swingLow },
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

    if (showHistory && levelsHistory.length > 0 && candles.length > 0) {
      const historyData = buildHistorySeriesData(levelsHistory, candles);

      for (const key of Object.keys(LEVEL_STYLES) as LevelKey[]) {
        const style = LEVEL_STYLES[key];
        const historySeries = chartRef.current?.addLineSeries({
          color: style.color,
          lineWidth: 2,
          lineType: LineType.WithSteps,
          lineStyle: style.style,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        if (!historySeries) continue;

        setHistoryData(historySeries, key, historyData[key]);
        historySeriesRef.current.push(historySeries);
      }
    }

    if (!didInitialFitRef.current && chartData.length > 0) {
      chartRef.current?.timeScale().fitContent();
      didInitialFitRef.current = true;
    }
  }, [chartData, candles, levels, levelsHistory, showHistory, interval]);

  return <div ref={containerRef} className="h-[540px] w-full overflow-hidden rounded border border-line bg-surface" />;
}

function toChartTime(timestamp: number): Time {
  return Math.floor(timestamp / 1000) as Time;
}

function buildHistorySeriesData(levelsHistory: Levels[], candles: Candle[]): Record<LevelKey, HistoryPoint[]> {
  const levelsByDay = new Map(levelsHistory.map((levels) => [levels.forUtcDay, levels]));
  const byLevel: Record<LevelKey, HistoryPoint[]> = {
    rangeHigh: [],
    swingHigh: [],
    rangeLow: [],
    swingLow: [],
  };

  const sortedCandles = [...candles].sort((a, b) => a.openTime - b.openTime);

  for (const candle of sortedCandles) {
    const time = toChartTime(candle.openTime);
    const levels = levelsByDay.get(formatUtcDay(candle.openTime));
    for (const key of Object.keys(byLevel) as LevelKey[]) {
      const value = levels?.[key] ?? null;
      byLevel[key].push(value === null ? { time } : { time, value });
    }
  }

  return {
    rangeHigh: sanitizeHistoryPoints(byLevel.rangeHigh),
    swingHigh: sanitizeHistoryPoints(byLevel.swingHigh),
    rangeLow: sanitizeHistoryPoints(byLevel.rangeLow),
    swingLow: sanitizeHistoryPoints(byLevel.swingLow),
  };
}

function sanitizeHistoryPoints(points: HistoryPoint[]): HistoryPoint[] {
  const seen = new Set<number>();
  const clean: HistoryPoint[] = [];

  for (const point of [...points].sort((a, b) => Number(a.time) - Number(b.time))) {
    const time = Number(point.time);
    if (seen.has(time)) continue;
    seen.add(time);
    clean.push(point);
  }

  return clean;
}

function setHistoryData(series: ISeriesApi<'Line'>, key: LevelKey, points: HistoryPoint[]) {
  try {
    series.setData(points);
  } catch (error) {
    console.warn(`Skipping ${key} history levels:`, error);
    series.setData([]);
  }
}

function formatUtcDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}
