// Voice: the browser's own speech recognition (lib/ui/use-speech.ts), no account or credits.
import { describe, expect, it } from "vitest";
import { canListen, joinHeard } from "@/lib/ui/use-speech";

const result = (transcript: string, isFinal = true) => ({ isFinal, 0: { transcript } });

describe("speech to text in the browser", () => {
  it("joins what was heard so far, settled words then the ones still being heard", () => {
    expect(joinHeard([result("plot the loss"), result(" for every  seed", false)])).toBe("plot the loss for every seed");
    expect(joinHeard([])).toBe("");
  });
  it("Chrome on Android's growing guesses are said once (the reported \"waitwait canwait can you…\")", () => {
    const growing = ["wait", "wait can", "wait can you", "wait can you hear", "wait can you hear me", "wait can you hear me so explain us parents"].map((t) => result(t, false));
    expect(joinHeard(growing)).toBe("wait can you hear me so explain us parents");
    expect(joinHeard([result("plot the loss"), result("plot the"), result("and save it")])).toBe("plot the loss and save it");
  });
  it("is off where the browser has no speech recognition (no microphone button)", () => {
    expect(canListen()).toBe(false); // the test environment has none
  });
});
