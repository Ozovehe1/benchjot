import { describe, expect, it } from "vitest";
import { errorFacts, errorKind, FriendlyError, upstreamFailure, userText, waitText } from "@/lib/user-message";
import { SCREEN_TEXT } from "@/components/error-screen";
import { ERROR_CASES } from "./fixtures/error-messages";

describe("user messages", () => {
  it.each(ERROR_CASES)("%s", (_name, facts, action, kind) => {
    expect(errorKind(facts)).toBe(kind);
    const text = userText(facts, action ?? undefined);
    expect(text).not.toMatch(/undefined|PGRST|JWT|jwt|23505|42501|row-level|duplicate key|Groq|TPD|\{wait\}/);
  });

  it("says the wait", () => {
    expect(userText({ status: 429, retryAfter: 90 }, "fix")).toBe("Fix has hit its limit for now. Try again in 2 minutes.");
    expect(userText({ message: "Please try again in 7m12.5s. tokens per day" }, "fix")).toBe("Fix has hit its limit for now. Try again in 8 minutes.");
    expect(userText({ code: "PT429" }, "sign_in")).toBe("Too many attempts. Try again in a few minutes.");
    expect(waitText(30)).toBe("a minute");
    expect(waitText(7200)).toBe("2 hours");
  });

  it("shows the app's own text and reads Supabase errors", () => {
    expect(userText(errorFacts(new FriendlyError("Project name is required.")))).toBe("Project name is required.");
    expect(errorKind(errorFacts(new Error("x", { cause: { code: "23505", status: 409 } })))).toBe("conflict");
    expect(errorKind(errorFacts(new TypeError("Failed to fetch")))).toBe("offline");
  });

  it("never passes provider text through an API answer", () => {
    expect(upstreamFailure({ status: 429, message: "groq says", retryAfterHeader: "12" })).toEqual({ kind: "rate_limited", status: 429, retryAfter: 12 });
    expect(upstreamFailure({ status: 500, message: "boom" })).toEqual({ kind: "server", status: 502 });
  });

  it("error screens carry no error text", () => {
    for (const t of Object.values(SCREEN_TEXT)) expect(`${t.title} ${t.body}`).not.toMatch(/error\.message|undefined/);
  });
});
