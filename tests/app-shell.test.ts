// The signed-in app's desktop frame: a sidebar from lg up, none on full-screen output pages, and
// pages hiding the logo and links the sidebar already has (only inside the shell, only on desktop).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("app shell", () => {
  it("wraps every signed-in page, with the user's name (there are no plans)", () => {
    expect(read("app/(app)/layout.tsx")).toMatch(/<AppShell username=\{account\.username\}>/);
  });

  it("is a desktop-only sidebar, absent on full-screen output pages", () => {
    const shell = read("components/app/app-shell.tsx");
    expect(shell).toContain('className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col');
    expect(shell).toContain("lg:flex");
    expect(shell).toContain("/^\\/n\\/[^/]+\\/out\\//");
    const out = /^\/n\/[^/]+\/out\//;
    expect(out.test("/n/abc/out/s1/0")).toBe(true);
    expect(out.test("/n/abc")).toBe(false);
  });

  it("pages hide their logo and Map/Settings links only inside the shell on desktop", () => {
    expect(read("app/globals.css")).toMatch(/@media \(min-width: 64rem\) \{\s*\[data-shell\] \.shell-hide \{ display: none; \}/);
    expect(read("components/ui/index.tsx")).toMatch(/<span className="shell-hide">\s*<Logo/);
    expect(read("components/notes/note-list.tsx")).toMatch(/href="\/map" className="shell-hide/);
  });
});
