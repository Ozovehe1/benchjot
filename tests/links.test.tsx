import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/markdown";
import { backlinksTo, completeLink, formatLink, LINK_PATTERN, linkQueryAt, linkSuggestions, parseLinks, resolveLink } from "@/lib/links";

const A = "0b6e6a9e-1111-4222-8333-444455556666";
const B = "1c7f7b0f-2222-4333-9444-555566667777";
const notes = [
  { id: A, title: "Dropout sweep" },
  { id: B, title: "Tokenizer study" },
];

describe("parseLinks", () => {
  it("splits text and links and round-trips", () => {
    const text = `see [[Old name|${A}]] and [[Tokenizer study]].`;
    const segs = parseLinks(text);
    expect(segs.map((s) => s.kind)).toEqual(["text", "link", "text", "link", "text"]);
    expect(segs[1]).toMatchObject({ label: "Old name", id: A });
    expect(segs[3]).toMatchObject({ label: "Tokenizer study", id: null });
    expect(segs.map((s) => (s.kind === "text" ? s.text : s.raw)).join("")).toBe(text);
  });
  it("ignores unclosed, multi-line, empty and bad-id links", () => {
    for (const t of ["[[open", "[[a\nb]]", "[[]]", "[[x|not-an-id]]", "[a]"]) {
      expect(parseLinks(t).every((s) => s.kind === "text")).toBe(true);
    }
  });
  it("lowercases ids", () => {
    expect(parseLinks(`[[x|${A.toUpperCase()}]]`)[0]).toMatchObject({ id: A });
  });
  it("uses the same pattern as note_links() in SQL", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261104040000_note_tree_and_links.sql", import.meta.url), "utf8");
    expect(sql).toContain(`'${LINK_PATTERN}'`);
  });
});

describe("formatLink / resolveLink", () => {
  it("stores the id and a safe label", () => {
    expect(formatLink("a [b] | c", A)).toBe(`[[a b c|${A}]]`);
    expect(parseLinks(formatLink("x]]y|z", A))[0]).toMatchObject({ kind: "link", id: A });
    expect(formatLink("  ", A)).toBe(`[[Untitled|${A}]]`);
  });
  it("resolves by id (renames don't matter), else by title", () => {
    expect(resolveLink({ label: "Old name", id: A }, notes)?.title).toBe("Dropout sweep");
    expect(resolveLink({ label: "tokenizer STUDY", id: null }, notes)?.id).toBe(B);
    expect(resolveLink({ label: "Dropout sweep", id: "00000000-0000-4000-8000-000000000000" }, notes)).toBeNull();
    expect(resolveLink({ label: "Nope", id: null }, notes)).toBeNull();
  });
});

describe("typing [[", () => {
  it("finds the query at the caret", () => {
    expect(linkQueryAt("a [[tok", 7)).toEqual({ start: 2, query: "tok" });
    expect(linkQueryAt("a [[", 4)).toEqual({ start: 2, query: "" });
    expect(linkQueryAt(`a [[x|${A}]] b`, 40)).toBeNull();
    expect(linkQueryAt("[[a\nb", 5)).toBeNull();
    expect(linkQueryAt("no link", 7)).toBeNull();
  });
  it("completes the link and swallows a typed ]]", () => {
    const r = completeLink("x [[tok]] y", 2, 7, notes[1]!);
    expect(r.text).toBe(`x [[Tokenizer study|${B}]] y`);
    expect(r.caret).toBe(r.text.indexOf(" y"));
  });
  it("suggests prefix matches first, never the note itself", () => {
    const list = [...notes, { id: "c", title: "Study of dropout" }, { id: "d", title: "" }];
    expect(linkSuggestions("drop", list, "x").map((n) => n.id)).toEqual([A, "c"]);
    expect(linkSuggestions("", list, A).map((n) => n.id)).toEqual([B, "c"]);
  });
});

describe("rendering", () => {
  const html = (md: string) => renderToStaticMarkup(<Markdown notes={notes}>{md}</Markdown>);
  it("renders a link as the note's current title, opening the note", () => {
    const out = html(`See [[Old name|${A}]].`);
    expect(out).toContain(`href="/n/${A}"`);
    expect(out).toContain(">Dropout sweep</a>");
    expect(out).not.toContain(A + "]]");
  });
  it("renders a missing note muted, not as a link", () => {
    const out = html("See [[Ghost]].");
    expect(out).toContain('<span class="note-link-missing"');
    expect(out).toContain(">Ghost</span>");
    expect(out).not.toContain("<a");
  });
  it("leaves links inside code alone and keeps external links external", () => {
    const out = html("`[[Tokenizer study]]` and [web](https://example.com)");
    expect(out).toContain("<code>[[Tokenizer study]]</code>");
    expect(out).toContain('target="_blank"');
  });
  it("works inside lists and emphasis", () => {
    expect(html(`- *[[Tokenizer study]]*`)).toContain(`href="/n/${B}"`);
  });
});

describe("backlinksTo", () => {
  it("lists each linking note once, by id or title, never itself", () => {
    const links = [
      { source: B, label: "x", id: A },
      { source: B, label: "Dropout sweep", id: null },
      { source: A, label: "Dropout sweep", id: null },
      { source: "c", label: "Other", id: null },
    ];
    const list = [...notes, { id: "c", title: "C" }];
    expect(backlinksTo(A, links, list).map((n) => n.id)).toEqual([B]);
    expect(backlinksTo(B, links, list)).toEqual([]);
  });
});
