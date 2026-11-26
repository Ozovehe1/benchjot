// Captures the landing's showcase pictures from the real app: the preview harness (.preview, the
// signed-in app with a sample account) in Chromium, saved as WebP in public/showcase/. Run it after a UI
// change so the landing shows the app as it is:
//   npx vite --config .preview/vite.config.mjs &   # http://localhost:5300
//   node scripts/capture-showcase.mjs
// Find datasets' results are the platforms' real answers for "iris" (searched 26 Nov 2026), served to the
// page in place of the app's /api/data/search, which the preview has no server for.
import { createRequire } from "node:module";
import sharp from "sharp";
import { mkdirSync } from "node:fs";

// Playwright may be installed globally (not a dependency of the app), so it is required, not imported.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.PREVIEW_URL ?? "http://localhost:5300/";
const NOTE = "e0000000-0000-4000-8000-000000000001";
const OUT = new URL("../public/showcase/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const IRIS = {
  results: [
    { source: "hf", id: "scikit-learn/iris", title: "scikit-learn/iris", detail: "", page: "https://huggingface.co/datasets/scikit-learn/iris" },
    { source: "openml", id: "61", title: "iris", detail: "", page: "https://www.openml.org/d/61" },
    { source: "zenodo", id: "1404173", title: "Scikit-Learn IRIS", detail: "", page: "https://zenodo.org/records/1404173" },
    { source: "dataverse", id: "doi:10.7910/DVN/R2RGXR", title: "Iris dataset for machine learning", detail: "", page: "https://doi.org/10.7910/DVN/R2RGXR" },
    { source: "openml", id: "969", title: "iris", detail: "", page: "https://www.openml.org/d/969" },
    { source: "zenodo", id: "10307104", title: "Iris", detail: "", page: "https://zenodo.org/records/10307104" },
  ],
  missed: [],
};

async function save(page, name, clip) {
  const png = await page.screenshot(clip ? { clip } : {});
  await sharp(png).webp({ quality: 86 }).toFile(`${OUT}${name}.webp`);
  console.log("saved", name);
}

/** Opens a page of the app fresh (the shell reads the address once). */
async function open(page, path) {
  await page.goto(`${BASE}#${path}`);
  await page.reload();
  await page.waitForTimeout(4500);
}

const browser = await chromium.launch();

/** Every screen, on a desktop (`name`) and on a phone (`name-phone`). */
async function screens(page, suffix) {
  await page.route("**/api/data/search**", (r) => r.fulfill({ json: IRIS }));

  // A note, from its top: title, outcome, what it asks and found, its cells.
  await open(page, `/n/${NOTE}`);
  await save(page, `note${suffix}`);

  // The note with the Assistant open beside it (on a phone, its sheet).
  await open(page, `/n/${NOTE}`);
  await page.getByRole("button", { name: "Assistant" }).first().click();
  await page.waitForTimeout(1500);
  await save(page, `note-assistant${suffix}`);

  // A cell, its run and what it made.
  await open(page, `/n/${NOTE}`);
  await page.locator("[id^='cell-']").first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 360));
  await page.waitForTimeout(1200);
  await save(page, `note-cell${suffix}`);

  // The same cell's figure, whole, with its caption and the note written after the run.
  await page.locator("[id^='cell-'] img").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate((desk) => window.scrollBy(0, desk ? -150 : -40), suffix === "");
  await page.waitForTimeout(1200);
  await save(page, `note-figure${suffix}`);

  // The note's Runs: chart and table.
  await page.locator("section[aria-label='Runs']").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -40));
  await page.waitForTimeout(1200);
  await save(page, `note-runs${suffix}`);

  for (const [path, name] of [["/figures", "figures"], ["/map", "map"], ["/", "notes"]]) {
    await open(page, path);
    await save(page, `${name}${suffix}`);
  }

  // Data, with Find datasets' results for "iris".
  await open(page, "/data");
  await page.getByRole("searchbox", { name: "Search datasets" }).fill("iris");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("region", { name: "Find datasets" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(800);
  await save(page, `data${suffix}`);
}

await screens(await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), "");
await screens(await browser.newPage({ ...devices["Pixel 7"] }), "-phone");
await browser.close();
