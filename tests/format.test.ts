import { describe, expect, it } from "vitest";
import { displayTitle, listDate } from "@/lib/format";

describe("displayTitle", () => {
  it("falls back to Untitled", () => {
    expect(displayTitle("  ")).toBe("Untitled");
    expect(displayTitle("LR sweep")).toBe("LR sweep");
  });
});

describe("listDate", () => {
  const now = new Date(2026, 10, 3, 18, 0);
  it("shows the time for today", () => {
    expect(listDate(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe("09:05");
  });
  it("shows day and month this year, with year otherwise", () => {
    expect(listDate(new Date(2026, 0, 2).toISOString(), now)).toBe("2 Jan");
    expect(listDate(new Date(2025, 0, 2).toISOString(), now)).toBe("2 Jan 2025");
  });
});
