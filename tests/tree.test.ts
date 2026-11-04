import { describe, expect, it } from "vitest";
import { entryPatch } from "@/lib/schemas";
import { ancestors, childrenOf, descendantIds, parentCandidates, wouldCycle } from "@/lib/tree";

// root > a > b > c ; root > d ; e alone
const n = (id: string, parent_id: string | null) => ({ id, title: id.toUpperCase(), parent_id });
const notes = [n("root", null), n("a", "root"), n("b", "a"), n("c", "b"), n("d", "root"), n("e", null)];

describe("ancestors", () => {
  it("lists the path root first", () => {
    expect(ancestors("c", notes).map((x) => x.id)).toEqual(["root", "a", "b"]);
    expect(ancestors("root", notes)).toEqual([]);
  });
  it("stops at a missing parent and never loops on a cycle", () => {
    expect(ancestors("x", [n("x", "gone")])).toEqual([]);
    expect(ancestors("p", [n("p", "q"), n("q", "p")]).map((x) => x.id)).toEqual(["q"]);
  });
});

describe("children and descendants", () => {
  it("finds direct sub-notes", () => {
    expect(childrenOf("root", notes).map((x) => x.id)).toEqual(["a", "d"]);
  });
  it("finds every note below", () => {
    expect([...descendantIds("root", notes)].sort()).toEqual(["a", "b", "c", "d"]);
    expect(descendantIds("c", notes).size).toBe(0);
  });
  it("terminates on bad data with a cycle", () => {
    expect([...descendantIds("p", [n("p", "q"), n("q", "p")])]).toEqual(["q"]);
  });
});

describe("cycle prevention", () => {
  it("refuses a note under itself or under its own descendants", () => {
    expect(wouldCycle("a", "a", notes)).toBe(true);
    expect(wouldCycle("a", "b", notes)).toBe(true);
    expect(wouldCycle("a", "c", notes)).toBe(true);
    expect(wouldCycle("root", "c", notes)).toBe(true);
  });
  it("allows siblings, unrelated notes, ancestors and clearing", () => {
    expect(wouldCycle("c", "d", notes)).toBe(false);
    expect(wouldCycle("a", "e", notes)).toBe(false);
    expect(wouldCycle("c", "root", notes)).toBe(false);
    expect(wouldCycle("a", null, notes)).toBe(false);
  });
  it("only offers parents that keep the tree a tree", () => {
    expect(parentCandidates("a", notes).map((x) => x.id)).toEqual(["root", "d", "e"]);
    for (const p of parentCandidates("a", notes)) expect(wouldCycle("a", p.id, notes)).toBe(false);
  });
});

describe("entryPatch parent_id", () => {
  it("sets, clears and rejects non-ids", () => {
    expect(entryPatch.safeParse({ parent_id: "0b6e6a9e-1111-4222-8333-444455556666" }).success).toBe(true);
    expect(entryPatch.safeParse({ parent_id: null }).success).toBe(true);
    expect(entryPatch.safeParse({ parent_id: "root" }).success).toBe(false);
  });
});
