'use client';

import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import type { PortfolioPoint } from '../../core/portfolio';

const CHART_THEME: Record<string, { bg: string; text: string; grid: string; border: string }> = {
  light: { bg: '#fbfaf6', text: '#373a3d', grid: '#ece8dc', border: '#d6d1c5' },
  dusk: { bg: '#343a47', text: '#ced3dd', grid: '#3e4552', border: '#4a5160' },
  dark: { bg: '#16181d', text: '#c4c8ce', grid: '#232730', border: '#2f343d' },
};

export default function PortfolioChart({ points, theme }: { points: PortfolioPoint[]; theme: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const data = useMemo<LineData[]>(() => points.map((point) => ({
    time: Math.floor(point.time / 1000) as Time,
    value: point.equity,
  })), [points]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const palette = CHART_THEME[theme] ?? CHART_THEME.light;
    const chart = createChart(containerRef.current, {
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: palette.bg },
        textColor: palette.text,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false },
    });
    const series = chart.addAreaSeries({
      lineColor: '#20885f',
      topColor: 'rgba(32, 136, 95, 0.30)',
      bottomColor: 'rgba(32, 136, 95, 0.02)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
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
    const palette = CHART_THEME[theme] ?? CHART_THEME.light;
    chartRef.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: palette.bg }, textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    });
  }, [theme]);

  useEffect(() => {
    seriesRef.current?.setData(data);
    if (data.length > 0) chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="h-[300px] w-full overflow-hidden border border-line bg-surface" />;
}
