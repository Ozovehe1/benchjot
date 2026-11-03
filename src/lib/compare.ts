// Side-by-side comparison of two runs' key-value maps.

export interface CompareRow<T> {
  key: string;
  a: T | undefined;
  b: T | undefined;
  same: boolean;
}

export function compareRecords<T>(a: Record<string, T>, b: Record<string, T>): CompareRow<T>[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => x.localeCompare(y));
  return keys.map((key) => ({ key, a: a[key], b: b[key], same: a[key] === b[key] }));
}

/** b - a, or null when either side is missing. */
export function metricDelta(a: number | undefined, b: number | undefined): number | null {
  return a === undefined || b === undefined ? null : b - a;
}

export function formatNumber(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6 || abs < 1e-3) return n.toExponential(3).replace(/\.?0+e/, "e");
  return Number(n.toPrecision(6)).toString();
}

export function formatDelta(d: number | null): string {
  if (d === null) return "";
  if (d === 0) return "±0";
  return `${d > 0 ? "+" : "−"}${formatNumber(Math.abs(d))}`;
}
