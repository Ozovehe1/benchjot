import { describe, expect, it } from "vitest";
import { cleanPythonTraceback, pythonErrorLine } from "@/lib/run/errors";
import { applyEdits, offsetOf } from "@/lib/run/ruff-fix";
import { cleanRError, rPackages } from "@/lib/run/r-packages";
import { runsInBrowser } from "@/lib/run/types";

const TB = `Traceback (most recent call last):
  File "/lib/python312.zip/_pyodide/_base.py", line 597, in eval_code_async
    await CodeRunner(
  File "<exec>", line 4, in <module>
  File "<exec>", line 2, in f
ZeroDivisionError: division by zero`;

describe("python errors", () => {
  it("points at the last frame in the user's code", () => {
    expect(pythonErrorLine(TB)).toBe(2);
    expect(pythonErrorLine("RuntimeError: boom")).toBeNull();
  });
  it("drops Pyodide's own frames", () => {
    const clean = cleanPythonTraceback(TB);
    expect(clean).not.toContain("_pyodide");
    expect(clean.startsWith("Traceback (most recent call last):\n  File \"<exec>\", line 4")).toBe(true);
    expect(clean).toContain("ZeroDivisionError");
  });
});

describe("ruff fix edits", () => {
  it("converts row/column to offsets", () => {
    expect(offsetOf("ab\ncd", { row: 2, column: 2 })).toBe(4);
  });
  it("applies non-overlapping edits from the end", () => {
    const text = "import os\nimport sys\nprint(sys.argv)\n";
    const out = applyEdits(text, [{ content: "", location: { row: 1, column: 1 }, end_location: { row: 2, column: 1 } }]);
    expect(out).toBe("import sys\nprint(sys.argv)\n");
  });
  it("skips an edit overlapping one already applied", () => {
    const out = applyEdits("abcdef", [
      { content: "X", location: { row: 1, column: 2 }, end_location: { row: 1, column: 5 } },
      { content: "Y", location: { row: 1, column: 4 }, end_location: { row: 1, column: 6 } },
    ]);
    expect(out).toBe("abcYf");
  });
});

describe("runsInBrowser", () => {
  it("covers Python and R only", () => {
    expect(runsInBrowser("python")).toBe(true);
    expect(runsInBrowser("r")).toBe(true);
    for (const no of ["sql", "bash", "markdown", "text"]) expect(runsInBrowser(no)).toBe(false);
  });
});

describe("R in the browser", () => {
  it("finds the packages a cell uses, without R's own or commented ones", () => {
    expect(rPackages('library(dplyr)\nrequire("ggplot2")\nx <- tidyr::pivot_longer(d)\n# library(notused)\nlibrary(stats)\nrequireNamespace("MASS")\nstats::sd(1:3)\nlibrary(dplyr)')).toEqual(["dplyr", "ggplot2", "MASS", "tidyr"]);
    expect(rPackages("x <- c(1, 2)\nprint(mean(x))")).toEqual([]);
    expect(rPackages("a$b::c")).toEqual(["b"]);
  });
  it("shows R's error in the user's terms: the line of a syntax error, no runner call", () => {
    expect(cleanRError('Error in source("/home/web_user/main.R", print.eval = TRUE, keep.source = TRUE): /home/web_user/main.R:2:0: unexpected end of input\n1: x <- (1 +\n   ^')).toEqual({ text: "Error: unexpected end of input\n1: x <- (1 +\n   ^", line: 2 });
    expect(cleanRError("Error in eval(ei, envir): plain")).toEqual({ text: "Error: plain", line: null });
    expect(cleanRError("Error in f(1): boom")).toEqual({ text: "Error in f(1): boom", line: null });
  });
  it("the runner loads WebR from its own CDN at a pinned version, and Stop throws the session away", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/lib/run/r-runner.ts", import.meta.url), "utf8");
    expect(src).toContain('export const WEBR_URL = "https://webr.r-wasm.org/v0.6.0/webr.mjs";');
    expect(src).toContain("needsServer: true"); // a package with no browser build: Run goes on to the server
    expect(src).toMatch(/const kill = [\s\S]*?discard\(\);/);
    expect(readFileSync(new URL("../next.config.ts", import.meta.url), "utf8")).toContain("https://webr.r-wasm.org https://repo.r-wasm.org");
  });
});
