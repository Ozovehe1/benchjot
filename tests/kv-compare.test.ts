import { describe, expect, it } from "vitest";
import { parseKVText, recordToRows, rowsToNumbers, rowsToStrings } from "@/lib/kv";
import { compareRecords, formatDelta, metricDelta } from "@/lib/compare";

describe("key-value rows", () => {
  it("round-trips and skips blank rows", () => {
    const rows = [...recordToRows({ lr: "3e-4" }), { key: " ", value: "" }];
    expect(rowsToStrings(rows)).toEqual({ ok: true, value: { lr: "3e-4" } });
  });
  it("keeps values that look like markers", () => {
    expect(rowsToStrings([{ key: "note", value: "!important" }])).toEqual({ ok: true, value: { note: "!important" } });
  });
  it("flags duplicate keys and missing keys", () => {
    expect(rowsToStrings([{ key: "a", value: "1" }, { key: "a", value: "2" }]).ok).toBe(false);
    expect(rowsToStrings([{ key: "", value: "2" }]).ok).toBe(false);
  });
  it("parses metric numbers", () => {
    expect(rowsToNumbers([{ key: "acc", value: "93.1%" }, { key: "loss", value: "1e-3" }, { key: "n", value: "1,000" }])).toEqual({
      ok: true,
      value: { acc: 93.1, loss: 0.001, n: 1000 },
    });
    expect(rowsToNumbers([{ key: "acc", value: "high" }]).ok).toBe(false);
  });
  it("parses pasted argparse / config text", () => {
    expect(parseKVText("--lr 3e-4\nbatch_size=64\n# comment\nseed: 42")).toEqual([
      { key: "lr", value: "3e-4" },
      { key: "batch_size", value: "64" },
      { key: "seed", value: "42" },
    ]);
  });
});

describe("run comparison", () => {
  it("unions keys and marks differences", () => {
    const rows = compareRecords({ lr: "1e-3", bs: "64" }, { lr: "3e-4", bs: "64", wd: "0.01" });
    expect(rows.map((r) => [r.key, r.same])).toEqual([["bs", true], ["lr", false], ["wd", false]]);
  });
  it("computes metric deltas", () => {
    expect(metricDelta(0.9, 0.93)).toBeCloseTo(0.03);
    expect(metricDelta(undefined, 1)).toBeNull();
    expect(formatDelta(-0.5)).toBe("−0.5");
    expect(formatDelta(0)).toBe("±0");
  });
});
