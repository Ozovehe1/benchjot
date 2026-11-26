// A tab opened before an update finds out and offers a reload (components/app/update-banner.tsx).
import { afterEach, describe, expect, it, vi } from "vitest";

const answer = (build: unknown, ok = true) => vi.fn(async () => new Response(JSON.stringify({ build }), { status: ok ? 200 : 503 })) as unknown as typeof fetch;

async function load(build: string | undefined) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_BUILD", build ?? "");
  return import("@/components/app/update-banner");
}
afterEach(() => vi.unstubAllEnvs());

describe("newerBuild", () => {
  it("is true only when the server runs another real build", async () => {
    const { newerBuild } = await load("abc");
    expect(await newerBuild(answer("def"))).toBe(true);
    expect(await newerBuild(answer("abc"))).toBe(false);
    expect(await newerBuild(answer("dev"))).toBe(false);
    expect(await newerBuild(answer(42))).toBe(false);
    expect(await newerBuild(answer("def", false))).toBe(false);
    expect(await newerBuild((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBe(false);
  });
  it("a local build never asks", async () => {
    const { newerBuild } = await load(undefined);
    const f = answer("def");
    expect(await newerBuild(f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("the server says which build it runs, never cached", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_BUILD", "abc");
    const { GET } = await import("@/app/api/version/route");
    const res = GET();
    expect(await res.json()).toEqual({ build: "abc" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
