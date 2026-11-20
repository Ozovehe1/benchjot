// Settings' connections as first rendered: Connect AI and Connect Hugging Face both
// start not connected, guide the user with direct links, mask what's typed and prefill nothing.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/supabase/client", () => ({ supabase: () => ({ rpc: async () => ({ data: null, error: null }) }) }));
const { DatasetKeys } = await import("@/components/account/dataset-keys");
const { ConnectAi } = await import("@/components/account/connect-ai");

describe("connections", () => {
  const ai = renderToStaticMarkup(<ConnectAi next="/welcome/boosts" />);
  const hf = renderToStaticMarkup(<DatasetKeys />);

  it("Connect AI is one button to OpenRouter, with what will happen and where keys are kept; nothing to paste", () => {
    expect(ai).toContain('href="/api/ai-key/connect?next=%2Fwelcome%2Fboosts"');
    expect(ai).toContain("Not connected");
    expect(ai).toContain("Authorize");
    expect(ai).toContain('href="/security"');
    expect(ai).not.toMatch(/<input/);
  });
  it("Hugging Face is one button to its sign-in; pasting a token stays possible, masked, and can't be saved empty", () => {
    expect(hf).toContain("Not connected");
    expect(hf).toContain('href="/api/hf/connect?next=%2Fsettings"');
    expect(hf).toContain("Allow");
    expect(hf).toContain("How it works");
    expect(hf).toContain('href="https://huggingface.co/settings/tokens"');
    expect(hf).toMatch(/aria-label="Hugging Face token"[^>]*type="password"|type="password"[^>]*aria-label="Hugging Face token"/);
    expect(hf).toContain('disabled=""');
    for (const html of [ai, hf]) expect(html).not.toMatch(/value="[^"]+"/);
  });
});

describe("Settings layout", () => {
  it("is grouped like a settings page: Account, Connections, Usage, Appearance; one keys link; compact connection rows", async () => {
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }), usePathname: () => "/settings" }));
    vi.doMock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme() {} }) }));
    const { Settings } = await import("@/components/account/settings");
    const html = renderToStaticMarkup(<Settings email="ada@example.com" username="ada" />);
    const order = ["Account", "Connections", "Usage", "Appearance"].map((t) => html.indexOf(`>${t}</h2>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/href="\/security"/g)).toHaveLength(1);
    expect(html).toContain('href="/api/ai-key/connect?next=%2Fsettings"');
    expect(html).toContain('href="/api/hf/connect?next=%2Fsettings"');
    expect(html).not.toMatch(/With it|Android/);
  });
});
