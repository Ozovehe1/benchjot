// Settings' connections as first rendered: Connect Hugging Face starts not connected, guide the user with direct links, mask what's typed and prefill nothing.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/supabase/client", () => ({ supabase: () => ({ rpc: async () => ({ data: null, error: null }) }) }));
const { DatasetKeys } = await import("@/components/account/dataset-keys");

describe("connections", () => {
  const hf = renderToStaticMarkup(<DatasetKeys />);

  it("Hugging Face is one button to its sign-in; pasting a token stays possible, masked, and can't be saved empty", () => {
    expect(hf).toContain("Not connected");
    expect(hf).toContain('href="/api/hf/connect?next=%2Fsettings"');
    expect(hf).toContain("Allow");
    expect(hf).toContain("How it works");
    expect(hf).toContain('href="https://huggingface.co/settings/tokens"');
    expect(hf).toMatch(/aria-label="Hugging Face token"[^>]*type="password"|type="password"[^>]*aria-label="Hugging Face token"/);
    expect(hf).toContain('disabled=""');
    for (const html of [hf]) expect(html).not.toMatch(/value="[^"]+"/);
  });
});

describe("Settings layout", () => {
  it("is grouped like a settings page: Account, AI, Usage, Appearance; connections have their own section", async () => {
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }), usePathname: () => "/settings" }));
    vi.doMock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme() {} }) }));
    const { Settings } = await import("@/components/account/settings");
    const html = renderToStaticMarkup(<Settings email="ada@example.com" username="ada" />);
    const order = ["Account", "AI", "Usage", "Appearance"].map((t) => html.indexOf(`>${t}</h2>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("/api/ai-key");
    expect(html).toContain(">Sonnet<");
    expect(html).toContain(">Haiku<");
    expect(html).not.toContain(">Connections</h2>");
    expect(html).not.toMatch(/With it|Android/);
  });
});
