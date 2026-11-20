// The connect step (/welcome/boosts): everyone passes through it once, nobody is held there, and
// the app offers a missing connection again where it's needed (ConnectPrompt). Usage is visible to
// the user only (Settings); the app has no page that shows another account's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETUP_COOKIE, SETUP_COOKIE_VALUE } from "@/lib/web/setup";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("connecting free accounts", () => {
  it("the step is passed through once (no AI yet, not seen in this browser) and never holds anyone", () => {
    for (const f of ["app/(app)/layout.tsx", "app/page.tsx"]) expect(src(f)).toContain('if (await setupPending()) redirect("/welcome/boosts");');
    const account = src("lib/server/account.ts");
    expect(account).toMatch(/if \(\(await cookies\(\)\)\.get\(SETUP_COOKIE\)\?\.value\) return false;\s*return !\(await connectionGate\(\)\)\.aiConnected;/);
    expect(account).not.toContain("gateBlocks");
    const boosts = src("app/welcome/boosts/page.tsx");
    expect(boosts).toContain("<ContinueSetup connected={gate.aiConnected} />"); // the way on is always there
    expect(boosts).not.toMatch(/Skip for now|aiRequired/);
    const way = src("components/account/continue-setup.tsx");
    expect(way).toContain("document.cookie = SETUP_COOKIE_VALUE");
    expect(way).toContain("Continue without AI");
    expect(way).toContain("Fix and the assistant stay off until you connect.");
    expect(SETUP_COOKIE_VALUE.startsWith(`${SETUP_COOKIE}=1; path=/;`)).toBe(true);
    expect(src("components/account/choose-username.tsx")).toContain('router.replace("/welcome/boosts")');
  });
  it("in the app, what needs a missing connection offers it in place", () => {
    const cell = src("components/code/cell-block.tsx");
    expect(cell).toContain('if ((e as { offer?: unknown } | null)?.offer === "own_key") setConnect("ai");'); // Suggest a fix
    expect(cell).toContain("<ConnectPrompt kind={connect} onDismiss={() => setConnect(null)} />");
    const assistant = src("components/notes/assistant-panel.tsx");
    expect(assistant).toContain("{needAi && <div"); // on opening, before a question is typed
    expect(assistant).toContain('{failed.offer === "own_key" && <ConnectPrompt kind="ai" />}');
    const prompt = src("components/account/connect-prompt.tsx");
    expect(prompt).toContain("`${c.href}?next=${encodeURIComponent(path)}`"); // connects from here, returns here
    expect(prompt).toContain('href: "/api/ai-key/connect"');
    expect(prompt).not.toContain('href: "/api/hf/connect"'); // voice needs no connection: the browser's own speech recognition
    expect(prompt).toContain("Not now");
  });
  it("Connect AI says what it changes, with and without it", () => {
    expect(src("components/account/connect-ai.tsx")).toContain(">With it</dt>");
    expect(src("components/account/connect-ai.tsx")).toContain(">Without</dt>");
  });

  it("usage: the user's own in Settings; no admin view of anyone's", () => {
    expect(src("components/account/settings.tsx")).toContain("<Usage />");
    expect(src("lib/server/account.ts")).not.toMatch(/admin/i);
    expect(src("lib/server/llm.ts")).toContain('session.db.rpc("ai_own_used")');
    expect(src("app/api/usage/route.ts")).not.toMatch(/rpc\("ai_key"\)/); // viewing usage never touches the AI key
  });
});
