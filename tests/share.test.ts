import { describe, expect, it } from "vitest";
import { SHARE_TOKEN, endOfDay, expiryText, localDay, isBot, shareDescription, sharedBody, sharedNote } from "@/lib/share/share";

const ID = "9f200000-0000-4000-8000-0000000000e2";

describe("a shared note as readers see it", () => {
  it("a link to a note that's shared too opens its page; other links read as their title", () => {
    expect(sharedBody(`See [[Other|${ID}]] and [[Private|9f200000-0000-4000-8000-0000000000e3]] and [[Bare]].`, { [ID]: "abcdefghijklmnopqrstuv" })).toBe(
      "See [Other](/s/abcdefghijklmnopqrstuv) and Private and Bare.",
    );
  });

  it("a link preview's description: the first plain words, no Markdown, links or code", () => {
    expect(shareDescription(`# Question\n\nDo **4 layers** beat 2? See [[Other|${ID}]].\n\n\`\`\`py\nx=1\n\`\`\`\n[docs](https://x.org)`)).toBe("Question Do 4 layers beat 2? See Other. docs");
    expect(shareDescription("a".repeat(400), 50)).toHaveLength(50);
    expect(shareDescription("Does a 4-layer net win?\n- one\n- two")).toBe("Does a 4-layer net win? one two");
  });

  it("previews and crawlers aren't counted as views; browsers are", () => {
    expect(isBot("WhatsApp/2.23")).toBe(true);
    expect(isBot("Slackbot-LinkExpanding 1.0")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe(false);
  });

  it("the link's end: a day picked in a calendar (its end), said in plain words", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    expect(localDay(endOfDay("2026-11-26")!)).toBe("2026-11-26"); // the end of the picked day, on this device
    expect(new Date(endOfDay("2026-11-26")!).getHours()).toBe(23);
    expect(endOfDay("")).toBeNull();
    expect(expiryText(null, now)).toBeNull();
    expect(expiryText("2026-11-26T12:00:00Z", now)).toBe("Ends in 7 days");
    expect(expiryText("2026-11-19T15:00:00Z", now)).toBe("Ends in 3 hours");
    expect(expiryText("2026-11-19T11:00:00Z", now)).toBe("Ended");
  });

  it("tokens are 22 URL-safe characters; the page's data is checked before it's shown", () => {
    expect(SHARE_TOKEN.test("3-_Oyw0PQI5EnTnKS7WZ-w")).toBe(true);
    expect(SHARE_TOKEN.test("../../etc/passwd")).toBe(false);
    const parsed = sharedNote.parse({
      token: "3-_Oyw0PQI5EnTnKS7WZ-w", show_code: true, allow_copy: true, indexable: false, expires_at: null, author: null,
      note: { id: ID, title: "T", notes: "", outcome: "weird", updated_at: "2026-11-19T12:00:00Z" },
      cells: [{ id: "c", filename: "", language: "python", content: "x", last_run: { not: "a run" }, note_before: "", note_after: "" }],
      links: {},
    });
    expect(parsed.note.outcome).toBeNull(); // an outcome the app doesn't know reads as unmarked
    expect(parsed.cells[0]!.last_run).toBeNull(); // a run that doesn't read shows as none, never breaks the page
  });
});
