import { describe, expect, it } from "vitest";
import { bearerToken } from "@/lib/server/bearer";

describe("bearerToken", () => {
  it("reads a Bearer token (case-insensitive scheme)", () => {
    expect(bearerToken("Bearer abc.def-ghi_jkl")).toBe("abc.def-ghi_jkl");
    expect(bearerToken("bearer eyJhbGciOi.x.y")).toBe("eyJhbGciOi.x.y");
  });
  it("ignores missing or malformed headers", () => {
    for (const bad of [null, undefined, "", "Bearer", "Bearer ", "Basic abc", "Bearer a b", "abc"]) expect(bearerToken(bad)).toBeNull();
  });
});
