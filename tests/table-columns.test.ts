// Table previews right-align a column only when every filled cell is a number, so a column that
// mixes numbers and words (31, "never") lines up instead of zig-zagging.
import { describe, expect, it } from "vitest";
import { numericColumns } from "@/lib/run/outputs";

describe("numericColumns", () => {
  it("numbers right, mixed and text left, index columns never", () => {
    const table = {
      index_columns: 1,
      columns: ["model", "accuracy", "reached at", "note", "empty"],
      rows: [
        ["4 units", 0.867, "never", "too small", null],
        ["32 units", 0.978, 31, "ok", null],
      ],
    };
    expect(numericColumns(table)).toEqual([false, true, false, false, false]);
  });

  it("missing values don't make a number column text", () => {
    expect(numericColumns({ index_columns: 0, columns: ["x"], rows: [[1], [null], [2.5]] })).toEqual([true]);
  });
});
