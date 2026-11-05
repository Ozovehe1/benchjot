import { describe, expect, it } from "vitest";
import { allRows, PAGE_ROWS } from "@/lib/pages";

const table = Array.from({ length: 2 * PAGE_ROWS + 37 }, (_, i) => i);
const server = (asked: [number, number][]) => async (from: number, to: number) => {
  asked.push([from, to]);
  return { data: table.slice(from, to + 1), error: null };
};

describe("allRows", () => {
  it("reads past the server's row cap (2,037 notes)", async () => {
    const asked: [number, number][] = [];
    expect(await allRows(server(asked))).toEqual(table);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("stops after one request for a short list, and on an exact page asks once more", async () => {
    const asked: [number, number][] = [];
    await allRows(async (f, t) => (asked.push([f, t]), { data: table.slice(f, Math.min(t + 1, PAGE_ROWS)), error: null }));
    expect(asked).toEqual([[0, 999], [1000, 1999]]);
  });
  it("fails loudly on an error", async () => {
    await expect(allRows(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
