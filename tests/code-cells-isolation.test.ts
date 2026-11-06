// Tools must never disturb code cells, code editors or run results (the user's rule, 2026-11-06).
import { readFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "@uiw/react-codemirror";
import { describe, expect, it } from "vitest";
import { languageSettings, loadGrammar } from "@/lib/cm-languages";
import { formatCommand } from "@/lib/live-editor";
import { MARKDOWN_FORMATS } from "@/lib/markdown-format";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
/** Only the import lines of a source file. */
const imports = (p: string) => src(p).split("\n").filter((l) => /^\s*(import|export .* from)/.test(l) || /from "/.test(l)).join("\n");

describe("body commands vs code cells", () => {
  it("applying every command to the body never changes any snippet's code or saved output", () => {
    const snippets = Object.freeze([
      Object.freeze({ id: "s1", code: "# comment\n- 1\n[] \nprint('**x**')", last_run: Object.freeze({ stdout: "# out\n- 1", outputs: null }) }),
    ]);
    const before = JSON.stringify(snippets);
    let body = EditorState.create({ doc: "Note text\n- item", selection: { anchor: 3, head: 7 } });
    for (const f of MARKDOWN_FORMATS) {
      formatCommand(f)({ state: body, dispatch: (tr) => (body = tr.state) });
    }
    expect(body.doc.toString()).not.toBe("Note text\n- item");
    expect(JSON.stringify(snippets)).toBe(before);
  });
  it("cell notes reach a code block only as slots it renders (before / after), never through its imports", () => {
    expect(src("components/snippet-block.tsx")).toMatch(/\{before\}[\s\S]*<SnippetHeader[\s\S]*\{after\}/);
  });
  it("the body's live modules don't reach snippets, and the code editor doesn't load them", () => {
    for (const p of ["lib/live-editor.ts", "lib/live-markdown.ts", "lib/markdown-format.ts", "components/format-bar.tsx", "components/live-text-block.tsx"]) {
      expect(imports(p), p).not.toMatch(/snippet|@\/lib\/data|code-editor|code-keys|\/run/);
    }
    for (const p of ["components/code-editor.tsx", "components/snippet-block.tsx", "components/code-keys.tsx"]) {
      expect(imports(p), p).not.toMatch(/live-editor|live-markdown|markdown-format|format-bar|live-text-block|cell-note/);
    }
  });
});

describe("code editor typing", () => {
  it.each(["python", "javascript", "plaintext"])("%s: `# comment`, `- 1`, `[] ` stay byte-for-byte", async (lang) => {
    const grammar = await loadGrammar(lang).catch(() => []);
    const ext = [basicSetup({ closeBrackets: true, autocompletion: true, indentOnInput: true }), grammar, languageSettings(lang)];
    for (const input of ["# comment", "- 1", "[] "]) {
      let s = EditorState.create({ doc: "", extensions: ext });
      for (const ch of input) {
        const at = s.selection.main.head;
        s = s.update({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: "input.type" }).state;
      }
      expect(s.doc.toString()).toBe(input);
    }
  });
});
