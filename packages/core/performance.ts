export interface RiskAdjustedRatios {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export function calculateRiskAdjustedRatios(
  returns: number[],
  annualizationFactor = 1,
): RiskAdjustedRatios {
  const values = returns.filter(Number.isFinite);
  if (values.length < 2) return { sharpeRatio: null, sortinoRatio: null };

  const mean = average(values);
  const standardDeviation = sampleStandardDeviation(values, mean);
  const downsideDeviation = Math.sqrt(average(values.map((value) => Math.min(value, 0) ** 2)));
  const scale = Math.sqrt(annualizationFactor);

  return {
    sharpeRatio: standardDeviation > 0 ? (mean / standardDeviation) * scale : null,
    sortinoRatio: downsideDeviation > 0 ? (mean / downsideDeviation) * scale : null,
  };
}

export function dailyEquityReturns(points: EquityPoint[]): number[] {
  const dailyCloses = new Map<string, EquityPoint>();
  for (const point of [...points].sort((a, b) => a.time - b.time)) {
    dailyCloses.set(new Date(point.time).toISOString().slice(0, 10), point);
  }

  const closes = [...dailyCloses.values()];
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1].equity;
    if (previous !== 0) returns.push(closes[index].equity / previous - 1);
  }
  return returns;
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1));
}
