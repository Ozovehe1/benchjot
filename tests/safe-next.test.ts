import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/n/abc?x=1")).toBe("/n/abc?x=1");
  });
  it("rejects other sites and empty values", () => {
    for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "n/abc"]) expect(safeNext(bad)).toBe("/");
  });
});
