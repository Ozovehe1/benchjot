import { describe, expect, it } from "vitest";
import { searchTerms } from "@/lib/search";

describe("searchTerms", () => {
  it("splits on whitespace and lowercases", () => {
    expect(searchTerms("  Cosine   Warmup ")).toEqual(["cosine", "warmup"]);
  });
  it("keeps punctuation so code matches literally", () => {
    expect(searchTerms("torch.cos x_1")).toEqual(["torch.cos", "x_1"]);
  });
  it("dedupes, caps term count and length", () => {
    expect(searchTerms("adam Adam")).toEqual(["adam"]);
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
    expect(searchTerms("x".repeat(100))[0]).toHaveLength(64);
  });
  it("returns nothing for blank input", () => {
    expect(searchTerms("   ")).toEqual([]);
  });
});
