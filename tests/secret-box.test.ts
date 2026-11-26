// Stored keys are encrypted (lib/server/secret-box.ts): sealed values differ each time, open only
// with the server's secret, fail closed when tampered with, and nothing is sealed without a secret.
import { afterEach, describe, expect, it, vi } from "vitest";
import { canSeal, isSealed, open, seal } from "@/lib/server/secret-box";

afterEach(() => vi.unstubAllEnvs());

describe("secret box", () => {
  it("seals and opens with the server's secret; each sealing is different", () => {
    vi.stubEnv("KEY_ENCRYPTION_SECRET", "a".repeat(48));
    const a = seal("sk-or-v1-secret");
    const b = seal("sk-or-v1-secret");
    expect(a).toMatch(/^enc:v1:[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("sk-or");
    expect(open(a)).toBe("sk-or-v1-secret");
    expect(isSealed(a)).toBe(true);
  });
  it("another secret, or a changed value, opens nothing", () => {
    vi.stubEnv("KEY_ENCRYPTION_SECRET", "a".repeat(48));
    const sealed = seal("secret");
    const at = sealed.length - 12; // inside the ciphertext, away from the last characters' spare bits
    expect(open(sealed.slice(0, at) + (sealed[at] === "A" ? "B" : "A") + sealed.slice(at + 1))).toBeNull();
    vi.stubEnv("KEY_ENCRYPTION_SECRET", "b".repeat(48));
    expect(open(sealed)).toBeNull();
  });
  it("without the secret nothing is sealed; values from before encryption still read", () => {
    vi.stubEnv("KEY_ENCRYPTION_SECRET", "");
    expect(canSeal()).toBe(false);
    expect(() => seal("x")).toThrow();
    expect(open("plain-old-key")).toBe("plain-old-key");
    expect(open(null)).toBeNull();
  });
});
