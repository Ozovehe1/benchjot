import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/markdown";
import { isOpenableLink, noteBodyHref, safeNext } from "@/lib/safe-next";
import { OPENABLE_LINK_CASES } from "./fixtures/openable-links";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/n/abc?x=1")).toBe("/n/abc?x=1");
  });
  it("rejects other sites, empty values and paths a browser would read as another host", () => {
    for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "n/abc", "/\t/evil.com", "/\n\\evil.com", "/\r//evil.com"]) expect(safeNext(bad)).toBe("/");
  });
});

describe("isOpenableLink", () => {
  it("opens only http, https and mailto", () => {
    const open = OPENABLE_LINK_CASES.filter(isOpenableLink);
    expect(open).toEqual(["https://example.com", "http://example.com/a?b=1#c", "HTTPS://EXAMPLE.COM", " https://example.com ", "mailto:someone@example.com"]);
  });
  it("keeps note links and footnotes in a note body, nothing else without a scheme", () => {
    expect(noteBodyHref("/n/abc")).toBe("/n/abc");
    expect(noteBodyHref("#user-content-fn-1")).toBe("#user-content-fn-1");
    for (const bad of ["javascript:alert(1)", "//evil.com", "docs/page", "data:text/html,x"]) expect(noteBodyHref(bad)).toBe("");
  });
});

describe("Markdown note body", () => {
  const html = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);
  it("drops javascript:, data: and vbscript: link targets", () => {
    for (const md of ["[x](javascript:alert(1))", "[x](JAVASCRIPT:alert(1))", "<javascript:alert(1)>", "[x](data:text/html,hi)", "[x](vbscript:msgbox)", "![x](javascript:alert(1))"]) {
      const out = html(md);
      expect(out).not.toMatch(/(href|src)="[^"]*(javascript|data|vbscript):/i);
      expect(out).not.toMatch(/<a[\s>]/);
    }
    expect(html("[x](https://example.com)")).toContain('href="https://example.com"');
    expect(html("[x](mailto:a@example.com)")).toContain('href="mailto:a@example.com"');
  });
  it("shows raw HTML as text, never as elements", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nhi <b onclick="x()">bold</b> <iframe src="https://evil.com"></iframe>');
    expect(out).not.toMatch(/<(script|img|iframe|b)[\s>/]/i);
    expect(out).toContain("&lt;script&gt;");
  });
});
