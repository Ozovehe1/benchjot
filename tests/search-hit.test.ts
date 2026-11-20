import { describe, expect, it } from "vitest";
import { searchHit } from "@/lib/notes/search-hit";

const cell = (id: string, content: string, note_before = "", note_after = "") => ({ id, filename: `${id}.py`, content, note_before, note_after });

describe("searchHit: where a search found a note", () => {
  it("finds the line in code first, with its cell and line number", () => {
    const hit = searchHit({ notes: "adam here too" }, [cell("a", "import numpy"), cell("b", "x = 1\nopt = Adam(lr=3e-4)")], ["adam"]);
    expect(hit).toEqual({ where: "code", cellId: "b", cell: 2, filename: "b.py", lineNo: 2, line: "opt = Adam(lr=3e-4)" });
  });
  it("then in the note, then in cell notes; not when only the title matched", () => {
    expect(searchHit({ notes: "first\nwarmup helps" }, [cell("a", "pass")], ["warmup"])).toMatchObject({ where: "note", lineNo: 2, line: "warmup helps" });
    expect(searchHit({ notes: "" }, [cell("a", "pass", "", "dropout 0.1 was best")], ["dropout"])).toMatchObject({ where: "cell note", cellId: "a", cell: 1 });
    expect(searchHit({ notes: "" }, [cell("a", "pass")], ["resnet"])).toBeNull();
  });
  it("cuts a long line around the word", () => {
    const line = `${"x".repeat(200)} target ${"y".repeat(200)}`;
    const hit = searchHit({ notes: line }, [], ["target"]);
    expect(hit!.line.length).toBeLessThanOrEqual(122);
    expect(hit!.line).toContain("target");
  });
});
