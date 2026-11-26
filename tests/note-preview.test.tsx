import { ANDROID_APK_URL } from "@/config/app";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotePreview } from "@/components/notes/note-preview";
import { highlightSpans } from "@/components/code/static-code";
import { FOLD_LINES, lineCount } from "@/lib/code/code-fold";
import { sampleOutputPath } from "@/lib/web/paths";
import { codeHash } from "@/lib/run/last-run";
import { outputLabel } from "@/lib/run/outputs";
import { SAMPLE_CELL_IDS, SAMPLE_NOTE, SAMPLE_OUTPUT_URLS, SAMPLE_OUTPUTS_BASE, SAMPLE_CELLS, SAMPLE_USED_GPU } from "@/lib/sample-note";
import { lastRun } from "@/lib/notes/schemas";

const outputs = SAMPLE_CELLS.map((s, cell) => ({ urls: SAMPLE_OUTPUT_URLS[cell]!, hrefs: s.last_run!.outputs!.items.map((_, i) => sampleOutputPath(cell, i)) }));
const html = renderToStaticMarkup(<NotePreview note={SAMPLE_NOTE} cells={SAMPLE_CELLS} outputs={outputs} />);
const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const showcase = readFileSync(new URL("../src/components/app/showcase.tsx", import.meta.url), "utf8");
const example = readFileSync(new URL("../src/app/example/page.tsx", import.meta.url), "utf8");
const [balls, digits] = SAMPLE_CELLS;

describe("landing note preview", () => {
  it("renders the title, outcome, body as markdown, both cells' code, notes and saved runs", () => {
    expect(html).toContain(SAMPLE_NOTE.title);
    expect(html).toContain(">Outcome<");
    expect(html).toContain(">Successful<");
    expect(html).toContain('<div class="prose-notes"><p><strong>Question</strong>');
    for (const [i, s] of SAMPLE_CELLS.entries()) {
      expect(html).toContain(`>${s.filename}<`);
      expect(html).toContain(`aria-label="Code ${i + 1}"`);
      expect(html).toContain(`aria-label="Note before run, ${s.filename}"`);
      expect(html).toContain(`aria-label="Note after run, ${s.filename}"`);
      expect(html).toContain(s.last_run!.stdout.split("\n")[0]);
    }
    expect(html).toContain('style="color:var(--hl-keyword)">import<'); // highlighted with the editor's colours
    expect(html).not.toContain("[Benchjot]"); // the app's notes about the machine it ran on then aren't shown
    expect(html).not.toMatch(/Server ready|chosen automatically/);
  });

  it("shows each cell's tables and figures, each opening on its own page", () => {
    expect(balls!.last_run!.outputs!.items.map((i) => i.kind)).toEqual(["table", "table", "image"]);
    expect(digits!.last_run!.outputs!.items.map((i) => i.kind)).toEqual(["table", "table", "image", "image"]);
    expect(html).toContain('src="/sample-outputs/digits/3.png"');
    expect(html).toContain(">4-layer convolutional<"); // a table row
    for (const [cell, o] of outputs.entries())
      for (const [i, h] of o.hrefs.entries()) {
        const item = SAMPLE_CELLS[cell]!.last_run!.outputs!.items[i]!;
        expect(html).toMatch(new RegExp(`<a aria-label="Open ${outputLabel(item)} ${i + 1}"[^>]*href="${h}"`));
      }
  });

  it("marks the parts the tour points at", () => {
    for (const part of ["question", "before", "code", "run", "outputs", "after"]) expect(html).toContain(`data-part="${part}"`);
    for (const cell of SAMPLE_CELLS.keys()) expect(html).toContain(`data-cell="${cell}"`);
    expect(html).toContain('data-part="outcome"');
  });

  it("is marked as an example of the app, on the example page and its output pages", () => {
    expect(example).toContain("<SampleNoteTag />");
    expect(readFileSync(new URL("../src/components/notes/note-parts.tsx", import.meta.url), "utf8")).toContain(">Sample note</span>");
    expect(page).not.toMatch(/read-only|preview of the app/i);
    expect(page).toMatch(/<header[^>]*justify-between">\s*<Logo \/>\s*<nav aria-label="Site"[\s\S]*?<TextLink href="\/login" strong>Sign in/); // header: logo left; links, Sign in right
    expect(readFileSync(new URL("../src/components/outputs/sample-output-viewer.tsx", import.meta.url), "utf8")).toContain("badge={<SampleNoteTag />}");
  });

  it("the landing shows the app itself: real screens captured from it, a tour of its parts", () => {
    expect(page.indexOf("<h1")).toBeLessThan(page.indexOf("/showcase/note.webp")); // the note leads; the Assistant is in the tour
    expect(page).toContain("<ScreenTour screens={SCREENS} />");
    expect(page).toContain("Screens from the app, with a sample account.");
    for (const name of ["note", "note-assistant", "note-cell", "note-runs", "data", "figures", "map", "notes"])
      for (const f of [name, `${name}-phone`]) expect(existsSync(new URL(`../public/showcase/${f}.webp`, import.meta.url)), f).toBe(true);
    expect(readFileSync(new URL("../scripts/capture-showcase.mjs", import.meta.url), "utf8")).toContain("public/showcase/");
    expect(showcase).toContain("setTimeout(() => setAt((i) => (i + 1) % screens.length), STEP_MS)"); // moves on by itself
    expect(showcase).not.toMatch(/onMouseEnter|onFocus/); // and hovering or tapping doesn't stop it
    expect(showcase).toContain("prefers-reduced-motion: reduce");
    expect(page).not.toContain("bg-ok"); // no "New" badge with a dot
    expect(SAMPLE_USED_GPU).toEqual([false, true]);
  });

  it("the Android button opens the download on the landing page: always the newest build, with how to install it", () => {
    const settings = readFileSync(new URL("../src/components/account/settings.tsx", import.meta.url), "utf8");
    const dialog = readFileSync(new URL("../src/components/account/android-download.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/<nav aria-label="Account"[\s\S]*<AndroidDownload[\s\S]*<\/nav>/);
    expect(settings).not.toContain("AndroidDownload");
    expect(ANDROID_APK_URL).toBe("https://github.com/Ozovehe1/benchjot-android/releases/latest/download/benchjot.apk");
    expect(dialog).toContain("href={ANDROID_APK_URL}");
  });

  it("folds long code to 12 lines with a toggle (the code block's shared frame)", () => {
    for (const s of SAMPLE_CELLS) {
      expect(lineCount(s.content)).toBeGreaterThan(FOLD_LINES);
      expect(html).toContain(`>Show all ${lineCount(s.content)} lines<`);
    }
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("whitespace-pre ");
  });

  it("has nothing editable and no actions (only the fold toggles)", () => {
    expect(html).not.toMatch(/<(textarea|input|select)\b/);
    expect(html.match(/<button\b/g)).toHaveLength(SAMPLE_CELLS.length);
    expect(html).not.toMatch(/contenteditable/i);
    expect(html).not.toMatch(/>(Run|Stop|Copy|Clear|Remove|Download run)</);
  });

  it("uses the note screen's own pieces (no second copy of the markup)", () => {
    const read = (f: string) => readFileSync(new URL(`../src/components/${f}`, import.meta.url), "utf8");
    for (const piece of ["NOTE_TITLE_CLASS", "NOTE_META_ROW_CLASS", "RenderedBody", "CellHeader", "RunOutput", "RunOutputs"]) expect(read("notes/note-preview.tsx")).toContain(piece);
    for (const piece of ["NOTE_TITLE_CLASS", "<RenderedBody"]) expect(read("notes/note-view.tsx")).toContain(piece);
    for (const piece of ["<CellHeader", "<RunOutputs", "<FoldedCode"]) expect(read("code/cell-block.tsx")).toContain(piece);
    expect(read("notes/note-preview.tsx")).toContain("<FoldedCode");
    expect(read("outputs/output-viewer.tsx")).toContain("<OutputView");
    expect(read("outputs/sample-output-viewer.tsx")).toContain("<OutputView");
  });

  it("imports nothing that talks to the network", () => {
    const files = ["notes/note-preview.tsx", "code/static-code.tsx", "notes/note-parts.tsx", "outputs/run-outputs.tsx", "outputs/output-view.tsx", "outputs/sample-output-viewer.tsx", "code/folded-code.tsx", "app/showcase.tsx"].map((f) => `../src/components/${f}`);
    for (const f of [...files, "../src/lib/sample-note.ts", "../src/app/example/page.tsx", "../src/app/example/[cell]/out/[index]/page.tsx"])
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).not.toMatch(/supabase|lib\/data|output-store|server-client|runner/);
  });

  it("stores valid saved runs of the code shown, with no account paths", () => {
    for (const s of SAMPLE_CELLS) {
      expect(lastRun.safeParse(s.last_run).success).toBe(true);
      expect(s.last_run!.code_hash).toBe(codeHash(s.content));
      expect(s.last_run!.where).toBe("server");
      expect(s.last_run!.outputs!.dir).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}\//); // a placeholder, not the account's folder
    }
    expect(readFileSync(new URL("../src/lib/sample-run.json", import.meta.url), "utf8")).not.toMatch(/53c7818c|(^|[\s"'(<])[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}(?![\w(])/i); // no account id, no email (decorators aren't)
  });

  it("bundles every output file, unchanged since it was copied (SHA256SUMS)", () => {
    const sums = readFileSync(new URL("../public/sample-outputs/SHA256SUMS", import.meta.url), "utf8").trim().split("\n");
    const listed = new Map(sums.map((l) => l.split("  ").reverse() as [string, string]));
    const served: string[] = [];
    for (const [cell, urls] of SAMPLE_OUTPUT_URLS.entries())
      for (const [name, url] of Object.entries(urls)) {
        expect(url).toBe(`${SAMPLE_OUTPUTS_BASE}/${SAMPLE_CELL_IDS[cell]}/${name}`);
        const path = new URL(`../public${url}`, import.meta.url);
        expect(existsSync(path), url).toBe(true);
        served.push(`${SAMPLE_CELL_IDS[cell]}/${name}`);
        expect(createHash("sha256").update(readFileSync(path)).digest("hex"), url).toBe(listed.get(`${SAMPLE_CELL_IDS[cell]}/${name}`));
      }
    expect(served.sort()).toEqual([...listed.keys()].sort());
  });

  it("its output pages and files are reachable signed out (middleware)", () => {
    const mw = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
    expect(mw).toMatch(/OPEN_PATHS = \[[^\]]*"\/example"/); // the whole note and its outputs
    expect(mw).toContain("|sample-outputs/|");
    expect(sampleOutputPath(1, 0)).toBe("/example/1/out/0");
  });
});

describe("highlightSpans", () => {
  it("keeps the code text exactly", () => {
    expect(highlightSpans(digits!.content, "python").map((s) => s.text).join("")).toBe(digits!.content);
  });
  it("renders unknown languages as plain text", () => {
    expect(highlightSpans("a b", "text")).toEqual([{ text: "a b" }]);
  });
});
