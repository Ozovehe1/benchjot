import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Pages the app links to. Runs on CI's checkout, so a page left out of git (e.g. by an
// ignore rule: a broad `out` once hid the output viewer) fails here instead of 404ing live.
const PAGES = ["src/app/(app)/n/[id]/page.tsx", "src/app/(app)/n/[id]/out/[snippetId]/[index]/page.tsx", "src/app/(app)/p/[id]/page.tsx"];

describe("routes", () => {
  it.each(PAGES)("%s is in the checkout", (p) => expect(existsSync(p)).toBe(true));
});
