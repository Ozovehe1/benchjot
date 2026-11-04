import { describe, expect, it } from "vitest";
import { afterDeletePath, notePath, projectPath } from "@/lib/paths";

describe("afterDeletePath", () => {
  it("returns to the note's project", () => {
    expect(afterDeletePath("p1")).toBe("/p/p1");
  });
  it("returns to all notes for an unfiled note", () => {
    for (const none of [null, undefined, ""]) expect(afterDeletePath(none)).toBe("/");
  });
});

describe("routes", () => {
  it("put the open note and project in the URL, so a reload lands on the same place", () => {
    expect(notePath("n1")).toBe("/n/n1");
    expect(projectPath("p1")).toBe("/p/p1");
  });
});
