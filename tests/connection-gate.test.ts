// AI needs no connection (one Claude for everyone): no connect step after sign-up, nothing in the
// app asks to connect AI. Usage is visible to the user only (Settings); the app has no page that
// shows another account's.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("AI without connecting", () => {
  it("no connect step, no Connect AI anywhere", () => {
    for (const f of ["app/(app)/layout.tsx", "app/page.tsx", "components/account/choose-username.tsx"]) expect(src(f)).not.toContain("/welcome/boosts");
    for (const f of ["app/welcome/boosts/page.tsx", "components/account/connect-ai.tsx", "components/account/connect-prompt.tsx", "app/api/ai-key/route.ts", "lib/server/openrouter.ts"]) expect(existsSync(new URL(`../src/${f}`, import.meta.url))).toBe(false);
    expect(src("components/notes/assistant-panel.tsx")).not.toContain("own_key");
    expect(src("components/code/cell-block.tsx")).not.toContain("own_key");
  });

  it("usage: the user's own in Settings; no admin view of anyone's", () => {
    expect(src("components/account/settings.tsx")).toContain("<Usage />");
    expect(src("lib/server/account.ts")).not.toMatch(/admin/i);
    expect(src("lib/server/llm.ts")).toContain('session.db.rpc("ai_spent", { credits })');
    expect(src("app/api/usage/route.ts")).not.toMatch(/rpc\("ai_key"\)/); // viewing usage never touches the AI key
  });
});
