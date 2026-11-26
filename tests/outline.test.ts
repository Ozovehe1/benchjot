// The note's table of contents (lib/notes/outline.ts), built as Jupyter builds it: from the headings
// the person wrote, never from code.
import { describe, expect, it } from "vitest";
import { contents, headingsOf, plainHeading } from "@/lib/notes/outline";

describe("headings, as Markdown and the note's editor read them", () => {
  it("# to ### at a line's start, in order, with their level", () => {
    expect(headingsOf("# Question\ntext\n## Setup\n### Seeds ###\n#### not a heading here\n#nospace")).toEqual([
      { level: 1, text: "Question" },
      { level: 2, text: "Setup" },
      { level: 3, text: "Seeds" },
    ]);
  });
  it("not inside fenced code, and never from comments in code", () => {
    expect(headingsOf("```python\n# ---- ribbon geometry (nm) ----\nx = 1\n```\n## Result")).toEqual([{ level: 2, text: "Result" }]);
  });
  it("read without Markdown marks", () => {
    expect(plainHeading("**Grain** size in `nm` vs [[Warmup sweep|e1]] and [paper](https://x.org)")).toBe("Grain size in nm vs Warmup sweep and paper");
    expect(plainHeading("_Texture_ ~~old~~ analysis")).toBe("Texture old analysis");
  });
});

describe("the table of contents", () => {
  it("headings and every cell, in page order; each cell under the heading above it", () => {
    const items = contents("# Nanocrystalline ribbon\n## Question", [
      { id: "c1", filename: "", note_before: "## Geometry", note_after: "" },
      { id: "c2", filename: "grains.py", note_before: null, note_after: "### Grain sizes" },
    ]);
    expect(items.map((i) => (i.kind === "heading" ? `h${i.level} ${i.text}` : `cell ${i.n}${i.title ? ` ${i.title}` : ""} under h${i.under}`))).toEqual([
      "h1 Nanocrystalline ribbon",
      "h2 Question",
      "h2 Geometry",
      "cell 1 under h2",
      "cell 2 grains.py under h2",
      "h3 Grain sizes",
    ]);
  });
  it("a note without headings still lists its cells, never names from code", () => {
    const items = contents("First simulate the ribbon.", [{ id: "c1", content: "# ---- ribbon geometry (nm) ----", note_before: "", note_after: "" } as never, { id: "c2", note_before: "", note_after: "" }]);
    expect(items).toEqual([
      { kind: "cell", key: "c1:cell", id: "c1", n: 1, title: "", under: 0 },
      { kind: "cell", key: "c2:cell", id: "c2", n: 2, title: "", under: 0 },
    ]);
  });
});

import { missingOnDevice } from "@/lib/run/python-imports";
describe("missingOnDevice: a library the device lacked at run time goes to the server", () => {
  it("names it when the server has it", () => {
    expect(missingOnDevice("Traceback…\nModuleNotFoundError: No module named 'openpyxl'")).toBe("openpyxl");
    expect(missingOnDevice("ModuleNotFoundError: No module named 'torch.nn'")).toBe("torch");
  });
  it("not for the device's own libraries, the standard library, or other errors", () => {
    expect(missingOnDevice("ModuleNotFoundError: No module named 'matplotlib.backends.x'")).toBeNull();
    expect(missingOnDevice("ModuleNotFoundError: No module named 'json'")).toBeNull();
    expect(missingOnDevice("ZeroDivisionError: division by zero")).toBeNull();
    expect(missingOnDevice(null)).toBeNull();
  });
});
