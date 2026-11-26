#!/usr/bin/env node
// Writes the shared JSON fixtures (tests/fixtures/*.json) from the hand-written case files, for the
// Android app to copy into core/src/test/resources/web/. The expected answers come from the case
// files, never from the implementation; tests/fixtures-json.test.ts fails if the JSON drifts.
// Run: node --experimental-strip-types scripts/write-fixtures.mjs
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const { buildFixtures } = await import(pathToFileURL(join(root, "tests/fixtures/build-fixtures.ts")).href);
for (const [name, data] of Object.entries(buildFixtures())) {
  writeFileSync(join(root, "tests/fixtures", name), JSON.stringify(data, null, 2) + "\n");
  console.log("wrote", name);
}
