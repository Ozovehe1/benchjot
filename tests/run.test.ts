import { describe, expect, it } from "vitest";
import { cleanPythonTraceback, jsErrorLine, pythonErrorLine } from "@/lib/run/errors";
import { applyEdits, offsetOf } from "@/lib/run/ruff-fix";
import { transpile } from "@/lib/run/transpile";
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

describe("js errors", () => {
  it("maps snippet.js lines back past the wrapper line", () => {
    expect(jsErrorLine("TypeError: x is not a function\n    at eval (snippet.js:4:3)")).toBe(3);
    expect(jsErrorLine("Error: no location")).toBeNull();
  });
});

describe("transpile", () => {
  it("strips types and keeps line numbers", () => {
    const r = transpile("const a: number = 1\ninterface X { a: string }\nconsole.log(a)", "typescript");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code.split("\n")[2]).toBe("console.log(a)");
  });
  it("reports syntax errors with a position", () => {
    const r = transpile("let x = 1\nconst y: number = ;", "typescript");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.line).toBe(2);
  });
  it("treats type annotations as errors in plain JS", () => {
    expect(transpile("const a: number = 1", "javascript").ok).toBe(false);
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
  it("covers Python and JS/TS only", () => {
    expect(runsInBrowser("python")).toBe(true);
    expect(runsInBrowser("typescript")).toBe(true);
    expect(runsInBrowser("go")).toBe(false);
  });
});
