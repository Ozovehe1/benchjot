import { describe, expect, it } from "vitest";
import { displayTitle, listDate, listDateLocal } from "@/lib/format";
import { LIST_DATE_CASES } from "./fixtures/list-date";

describe("displayTitle", () => {
  it("falls back to Untitled", () => {
    expect(displayTitle("  ")).toBe("Untitled");
    expect(displayTitle("LR sweep")).toBe("LR sweep");
  });
});

describe("listDateLocal", () => {
  it.each(LIST_DATE_CASES)("%s", (_name, then, now, want) => {
    expect(listDateLocal(then, now)).toBe(want);
  });
});

describe("listDate", () => {
  it("reads the browser's local time", () => {
    const now = new Date(2026, 10, 5, 18, 0);
    expect(listDate(new Date(2026, 10, 5, 9, 5).toISOString(), now)).toBe("09:05");
    expect(listDate(new Date(2026, 10, 4, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(listDate(new Date(2026, 10, 2, 12, 0).toISOString(), now)).toBe("Mon");
    expect(listDate(new Date(2025, 10, 3, 12, 0).toISOString(), now)).toBe("3 Nov 2025");
  });
});
