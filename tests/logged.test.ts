// Experiment tracking, pure (lib/run/logged.ts): how logged values read, and how runs become a table.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chartDefault, differences, formatLogged, loggedColumns, numericColumn, series, sortRuns } from "@/lib/run/logged";
import { logged, type Logged } from "@/lib/run/outputs";

const runs: { id: string; ranAt: string; logged: Logged }[] = [
  { id: "c", ranAt: "2026-11-26T10:00:00Z", logged: { accuracy: 0.961, lr: 0.01, model: "mlp" } },
  { id: "b", ranAt: "2026-11-26T09:00:00Z", logged: { accuracy: 0.912, lr: 0.1, model: "mlp", epochs: 10 } },
  { id: "a", ranAt: "2026-11-26T08:00:00Z", logged: { lr: 0.3, model: "linear" } },
];

describe("logged values", () => {
  it("read plainly: 4 significant digits, whole numbers as they are, tiny or huge in exponent form", () => {
    expect(formatLogged(0.961234)).toBe("0.9612");
    expect(formatLogged(20)).toBe("20");
    expect(formatLogged(12345)).toBe("12,345");
    expect(formatLogged(0.00001234)).toBe("1.234e-5");
    expect(formatLogged(true)).toBe("true");
    expect(formatLogged("mlp")).toBe("mlp");
    expect(formatLogged(undefined)).toBe("");
  });
  it("the schema takes numbers, short text and flags; not NaN, objects, or more than 50", () => {
    expect(logged.safeParse({ a: 1, b: "x", c: false }).success).toBe(true);
    expect(logged.safeParse({ a: Number.NaN }).success).toBe(false);
    expect(logged.safeParse({ a: [1] }).success).toBe(false);
    expect(logged.safeParse(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]))).success).toBe(false);
  });
});

describe("the Runs table", () => {
  it("columns: every logged name, newest run's order first", () => {
    expect(loggedColumns(runs)).toEqual(["accuracy", "lr", "model", "epochs"]);
  });
  it("number columns line up and chart; text ones don't", () => {
    expect(numericColumn(runs, "accuracy")).toBe(true);
    expect(numericColumn(runs, "model")).toBe(false);
    expect(series(runs, "accuracy")).toEqual([{ at: "2026-11-26T09:00:00Z", value: 0.912 }, { at: "2026-11-26T10:00:00Z", value: 0.961 }]);
  });
  it("sorts by a column, runs without it last; by time when none", () => {
    expect(sortRuns(runs, "accuracy", true).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortRuns(runs, "accuracy", false).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortRuns(runs, "lr", true).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortRuns(runs, null, false).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("compare: what differs between two runs", () => {
    expect(differences(runs[0]!.logged, runs[1]!.logged)).toEqual(["accuracy", "lr", "epochs"]);
  });
});

describe("the chart", () => {
  it("opens on a result, not a setting", () => {
    expect(chartDefault(["lr", "epochs", "accuracy", "loss"])).toBe("accuracy");
    expect(chartDefault(["lr", "val_loss"])).toBe("val_loss");
    expect(chartDefault(["lr", "epochs"])).toBe("lr");
    expect(chartDefault([])).toBeNull();
  });
});

describe("a run that logs but draws nothing still keeps its logged values", () => {
  it("server runs: logged comes from the manifest even with no outputs", async () => {
    const { toRunResult } = await import("@/lib/run/server-client");
    const { result } = toRunResult({ outcome: "ok", stdout: "R2 0.9996\n", stderr: "", exitCode: 0, ms: 8884, line: null, outputs: { manifest: { version: 1, items: [], notes: [], logged: { r2: 0.9996, model: "MLP 64x3" } }, files: {} } } as never);
    expect(result.outputs).toBeUndefined();
    expect(result.logged).toEqual({ r2: 0.9996, model: "MLP 64x3" });
  });
  it("browser runs: the worker posts logged values on their own", () => {
    const worker = readFileSync(new URL("../public/workers/python.js", import.meta.url), "utf8");
    expect(worker).toContain('if (outputs && outputs.manifest.logged) post({ id, type: "logged", logged: outputs.manifest.logged });');
    const runner = readFileSync(new URL("../src/lib/run/runner.ts", import.meta.url), "utf8");
    expect(runner).toContain('case "logged":');
    expect(readFileSync(new URL("../src/components/code/cell-block.tsx", import.meta.url), "utf8")).toContain("r.logged ?? r.outputs?.manifest.logged");
  });
});
