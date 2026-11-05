import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotePreview } from "@/components/note-preview";
import { highlightSpans } from "@/components/static-code";
import { FOLD_LINES, lineCount } from "@/lib/code-fold";
import { sampleOutputPath } from "@/lib/paths";
import { codeHash } from "@/lib/run/last-run";
import { outputLabel } from "@/lib/run/outputs";
import { SAMPLE_ENTRY, SAMPLE_OUTPUT_URLS, SAMPLE_OUTPUTS_BASE, SAMPLE_SNIPPETS } from "@/lib/sample-note";
import { lastRun } from "@/lib/schemas";

const urls = SAMPLE_OUTPUT_URLS;
const sample = SAMPLE_SNIPPETS[0]!;
const items = sample.last_run!.outputs!.items;
const hrefs = items.map((_, i) => sampleOutputPath(i));
const html = renderToStaticMarkup(<NotePreview entry={SAMPLE_ENTRY} snippets={SAMPLE_SNIPPETS} outputs={{ urls, hrefs }} />);

describe("landing note preview", () => {
  it("renders the title, outcome, body as markdown, the code header, the code and the saved output", () => {
    expect(html).toContain(SAMPLE_ENTRY.title);
    expect(html).toContain(">Outcome<");
    expect(html).toContain(">Successful<");
    expect(html).toContain('<div class="prose-notes"><p><strong>Goal</strong>'); // Markdown, as the editor's Preview
    expect(html).toContain(">digits.py<");
    expect(html).toContain(">Python<");
    expect(html).toContain('aria-label="Code 1"');
    expect(html).toContain('style="color:var(--hl-keyword)">for<'); // highlighted with the editor's colours
    expect(html).toContain('aria-label="Output"'); // RunOutput
    expect(html).toContain(sample.last_run!.stdout.split("\n")[0]);
    expect(html).toContain(`${(sample.last_run!.ms / 1000).toFixed(2)} s`);
  });

  it("shows a metrics table, a figure and an interactive chart, each opening on its own page", () => {
    expect(items.map((i) => i.kind)).toEqual(["table", "image", "chart"]);
    expect(html).toContain('aria-label="Figures and tables"');
    expect(html).toContain(">forest<"); // a table row
    expect(html).toContain('src="/sample-outputs/1.png"');
    expect(html).toContain('aria-label="F1 per digit"'); // ChartView, drawn in the browser
    for (const [i, h] of hrefs.entries()) expect(html).toMatch(new RegExp(`<a aria-label="Open ${outputLabel(items[i]!)} ${i + 1}"[^>]*href="${h}"`));
  });

  it("is marked as an example of the app, on the landing and its output pages", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<SampleNoteTag />");
    expect(readFileSync(new URL("../src/components/note-parts.tsx", import.meta.url), "utf8")).toContain(">Sample note</span>");
    expect(page).not.toMatch(/read-only|preview of the app/i);
    expect(page).toMatch(/<header[^>]*justify-between">\s*<Logo \/>\s*<TextLink href="\/login" strong>\s*Sign in/); // header: logo left, Sign in right
    expect(readFileSync(new URL("../src/components/sample-output-viewer.tsx", import.meta.url), "utf8")).toContain("badge={<SampleNoteTag />}");
  });

  it("phones read pitch, sample, then account links; desktop puts the sample in a right-hand column", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const at = (s: string) => page.indexOf(s);
    expect(at("<h1")).toBeLessThan(at("<figure"));
    expect(at("<figure")).toBeLessThan(at('<nav aria-label="Account"'));
    expect(page).toMatch(/<figure[^>]*lg:col-start-2/);
    expect(page).toMatch(/<nav aria-label="Account"[^>]*lg:col-start-1/);
    expect(page).toContain("lg:max-w-[1080px]");
  });

  it("links to the newest Android APK from one constant (landing and settings), no build tag", async () => {
    const { ANDROID_APK_URL } = await import("@/config/app");
    expect(ANDROID_APK_URL).toBe("https://github.com/Ozovehe1/benchjot-android/releases/latest/download/benchjot.apk");
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../src/components/settings.tsx", import.meta.url), "utf8");
    for (const src of [page, settings]) {
      expect(src).toContain("href={ANDROID_APK_URL}");
      expect(src).not.toMatch(/build-\d+|releases\/download\//);
    }
    // In the account links under the sample (48px TextLink), not in the header.
    expect(page).toMatch(/<nav aria-label="Account"[\s\S]*href=\{ANDROID_APK_URL\}[\s\S]*<\/nav>/);
    expect(page.slice(page.indexOf("<header"), page.indexOf("</header>"))).not.toContain("ANDROID_APK_URL");
  });

  it("folds long code to 12 lines with a toggle (the code block's shared frame)", () => {
    expect(lineCount(sample.content)).toBeGreaterThan(FOLD_LINES);
    expect(html).toContain(`>Show all ${lineCount(sample.content)} lines<`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("whitespace-pre "); // lines scroll sideways, no wrapping
  });

  it("has nothing editable and no actions (only the fold toggle)", () => {
    expect(html).not.toMatch(/<(textarea|input|select)\b/);
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/contenteditable/i);
    expect(html).not.toMatch(/>(Run|Stop|Copy|Clear|Remove|Download run)</);
  });

  it("uses the note screen's own pieces (no second copy of the markup)", () => {
    const read = (f: string) => readFileSync(new URL(`../src/components/${f}`, import.meta.url), "utf8");
    for (const piece of ["NOTE_TITLE_CLASS", "NOTE_META_ROW_CLASS", "RenderedBody", "SnippetHeader", "RunOutput", "RunOutputs"]) expect(read("note-preview.tsx")).toContain(piece);
    for (const piece of ["NOTE_TITLE_CLASS", "NOTE_META_ROW_CLASS", "<RenderedBody"]) expect(read("entry-view.tsx")).toContain(piece);
    for (const piece of ["<SnippetHeader", "<RunOutputs", "<FoldedCode"]) expect(read("snippet-block.tsx")).toContain(piece);
    expect(read("note-preview.tsx")).toContain("<FoldedCode");
    expect(read("output-viewer.tsx")).toContain("<OutputView");
    expect(read("sample-output-viewer.tsx")).toContain("<OutputView");
    expect(read("code-editor.tsx")).toContain("CODE_TOKENS");
  });

  it("imports nothing that talks to the network", () => {
    const files = ["note-preview.tsx", "static-code.tsx", "note-parts.tsx", "run-outputs.tsx", "chart-view.tsx", "output-view.tsx", "sample-output-viewer.tsx", "folded-code.tsx"].map((f) => `../src/components/${f}`);
    for (const f of [...files, "../src/lib/sample-note.ts", "../src/app/example/out/[index]/page.tsx"])
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).not.toMatch(/supabase|lib\/data|output-store|server-client|runner/);
  });

  it("stores a valid, current saved run whose files are bundled", () => {
    expect(lastRun.safeParse(sample.last_run).success).toBe(true);
    expect(sample.last_run!.code_hash).toBe(codeHash(sample.content));
    expect(sample.last_run!.where).toBe("server"); // captured by bj_capture.py under CPython, as server runs are
    for (const [name, url] of Object.entries(urls)) {
      expect(url).toBe(`${SAMPLE_OUTPUTS_BASE}/${name}`);
      expect(existsSync(new URL(`../public${url}`, import.meta.url)), name).toBe(true);
    }
    expect(Object.keys(urls).sort()).toEqual(["0.csv", "1.pdf", "1.png", "1.svg", "2.json"]);
  });

  it("its output pages and files are reachable signed out (middleware)", () => {
    const mw = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
    expect(mw).toMatch(/OPEN_PATHS = \[[^\]]*"\/example\/"/);
    expect(mw).toContain("|sample-outputs/|");
    expect(sampleOutputPath(0).startsWith("/example/")).toBe(true);
  });

  it("shows experiment.py as is (CI reruns it: scripts/sample-note/make.py --check)", () => {
    expect(readFileSync(new URL("../scripts/sample-note/experiment.py", import.meta.url), "utf8")).toBe(sample.content);
  });
});

describe("highlightSpans", () => {
  it("keeps the code text exactly", () => {
    expect(highlightSpans(sample.content, "python").map((s) => s.text).join("")).toBe(sample.content);
  });
  it("renders unknown languages as plain text", () => {
    expect(highlightSpans("a b", "text")).toEqual([{ text: "a b" }]);
  });
});
