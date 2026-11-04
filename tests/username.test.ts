import { describe, expect, it } from "vitest";
import { isValidUsername, looksLikeEmail, normalizeUsername, suggestUsername } from "@/lib/username";

describe("username", () => {
  it("normalizes case, spaces and a leading @", () => {
    expect(normalizeUsername("  @Ada_99 ")).toBe("ada_99");
  });
  it("validates length and characters", () => {
    expect(isValidUsername("ada")).toBe(true);
    expect(isValidUsername("a".repeat(20))).toBe(true);
    for (const bad of ["ab", "a".repeat(21), "ada-l", "Ada", "ada l", ""]) expect(isValidUsername(bad)).toBe(false);
  });
  it("suggests from an email", () => {
    expect(suggestUsername("Ada.Lovelace+x@gmail.com")).toBe("ada_lovelace");
    expect(suggestUsername("ab@x.com")).toBe("");
    expect(suggestUsername(null)).toBe("");
    expect(isValidUsername(suggestUsername("abdulcosman01@gmail.com"))).toBe(true);
  });
  it("tells emails from usernames", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("@ada")).toBe(false);
    expect(looksLikeEmail("ada")).toBe(false);
  });
});
