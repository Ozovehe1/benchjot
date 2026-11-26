// The JSON fixtures Android copies must be exactly the hand-written cases (regenerate with
// `node --experimental-strip-types scripts/write-fixtures.mjs`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFixtures } from "./fixtures/build-fixtures.ts";

describe("shared JSON fixtures", () => {
  for (const [name, data] of Object.entries(buildFixtures())) {
    it(`${name} is up to date`, () => {
      const disk = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
      expect(disk).toEqual(JSON.parse(JSON.stringify(data)));
    });
  }
  it("live_markdown.json has at least 30 live view cases", () => {
    const live = buildFixtures()["live_markdown.json"] as { liveSpans: unknown[] };
    expect(live.liveSpans.length).toBeGreaterThanOrEqual(30);
  });
});
