import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotePreview } from "@/components/note-preview";
import { highlightSpans } from "@/components/static-code";
import { codeHash } from "@/lib/run/last-run";
import { SAMPLE_ENTRY, SAMPLE_SNIPPETS } from "@/lib/sample-note";
import { lastRun } from "@/lib/schemas";

const html = renderToStaticMarkup(<NotePreview entry={SAMPLE_ENTRY} snippets={SAMPLE_SNIPPETS} />);
const sample = SAMPLE_SNIPPETS[0]!;

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("landing note preview", () => {
  it("renders the title, the body as markdown, the code header, the code and the saved output", () => {
    expect(html).toContain(SAMPLE_ENTRY.title);
    expect(html).toContain(`<div class="prose-notes"><p>${SAMPLE_ENTRY.notes}</p></div>`); // Markdown, as the editor's Preview
    expect(html).toContain(">dropout.py<");
    expect(html).toContain(">Python<");
    expect(html).toContain('aria-label="Code 1"');
    expect(html).toContain('style="color:var(--hl-keyword)">for<'); // highlighted with the editor's colours
    expect(html).toContain('aria-label="Output"'); // RunOutput
    expect(html).toContain("0.1 92.1\n0.3 90.9");
    expect(html).toContain("0.04 s");
  });

  it("has nothing editable and no actions", () => {
    expect(html).not.toMatch(/<(textarea|input|select|button)\b/);
    expect(html).not.toMatch(/contenteditable/i);
    expect(html).not.toMatch(/>(Run|Stop|Copy|Clear|Remove)</);
  });

  it("uses the note screen's own pieces (no second copy of the markup)", () => {
    const src = readFileSync(new URL("../src/components/note-preview.tsx", import.meta.url), "utf8");
    for (const piece of ["NOTE_TITLE_CLASS", "RenderedBody", "SnippetHeader", "RunOutput"]) expect(src).toContain(piece);
    const editor = readFileSync(new URL("../src/components/entry-view.tsx", import.meta.url), "utf8");
    expect(editor).toContain("NOTE_TITLE_CLASS");
    expect(editor).toContain("<RenderedBody");
    expect(readFileSync(new URL("../src/components/snippet-block.tsx", import.meta.url), "utf8")).toContain("<SnippetHeader");
    expect(readFileSync(new URL("../src/components/code-editor.tsx", import.meta.url), "utf8")).toContain("CODE_TOKENS");
  });

  it("imports nothing that talks to the network", () => {
    const files = ["../src/components/note-preview.tsx", "../src/components/static-code.tsx", "../src/components/note-parts.tsx", "../src/lib/sample-note.ts"];
    for (const f of files) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/supabase|lib\/data|server-client|runner/);
  });

  it("stores a valid, current saved run", () => {
    expect(lastRun.safeParse(sample.last_run).success).toBe(true);
    expect(sample.last_run!.code_hash).toBe(codeHash(sample.content));
  });

  it.skipIf(!hasPython())("saved output is what the code prints", () => {
    expect(execFileSync("python3", ["-c", sample.content], { encoding: "utf8" })).toBe(sample.last_run!.stdout);
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
