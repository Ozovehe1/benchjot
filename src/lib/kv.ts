// Key-value rows <-> records, for run params, environment and metrics.

export interface KVRow {
  key: string;
  value: string;
}

export type KVResult<T> = { ok: true; value: Record<string, T> } | { ok: false; error: string };

export function recordToRows(record: Record<string, string | number> | null | undefined): KVRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value: String(value) }));
}

type Parsed<T> = { value: T } | { error: string };

function collect<T>(rows: KVRow[], parse: (raw: string, key: string) => Parsed<T>): KVResult<T> {
  const out: Record<string, T> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const raw = row.value.trim();
    if (!key && !raw) continue; // blank row: ignore
    if (!key) return { ok: false, error: `Value "${raw}" has no key` };
    if (Object.hasOwn(out, key)) return { ok: false, error: `Duplicate key "${key}"` };
    const parsed = parse(raw, key);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    out[key] = parsed.value;
  }
  return { ok: true, value: out };
}

export function rowsToStrings(rows: KVRow[]): KVResult<string> {
  return collect(rows, (raw) => ({ value: raw }));
}

/** Parses "0.93", "1e-4", "93%" (-> 93), "1,000" (-> 1000). */
export function rowsToNumbers(rows: KVRow[]): KVResult<number> {
  return collect<number>(rows, (raw, key) => {
    const cleaned = raw.replace(/[%,_\s]/g, "");
    const n = cleaned === "" ? Number.NaN : Number(cleaned);
    return Number.isFinite(n) ? { value: n } : { error: `Metric "${key}" must be a number (got "${raw}")` };
  });
}

/** Parse "key=value" / "key: value" lines, e.g. pasted from argparse or a config. */
export function parseKVText(text: string): KVRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const m = /^--?([^=:\s]+)\s*[=:\s]\s*(.*)$/.exec(line) ?? /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line);
      return m ? { key: (m[1] ?? "").trim(), value: (m[2] ?? "").trim() } : { key: line, value: "" };
    });
}
