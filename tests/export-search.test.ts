import { describe, expect, it } from "vitest";
import { experimentToMarkdown, exportFilename } from "@/lib/export";
import { buildTsQuery } from "@/lib/search";
import { guessLanguage } from "@/lib/languages";
import type { Experiment, Run, Snippet } from "@/lib/schemas";

const exp: Experiment = {
  id: "e1", user_id: "u", project_id: null, title: "LR warmup | ablation", hypothesis: "Warmup helps.",
  status: "done", tags: ["vit", "cifar10"], notes: "Loss $\\mathcal{L}$ dropped.", pinned: false,
  started_on: "2026-11-01", ended_on: null, created_at: "", updated_at: "",
};
const snip: Snippet = {
  id: "s1", user_id: "u", experiment_id: "e1", filename: "train.py", language: "python",
  content: "print('```')", position: 0, created_at: "", updated_at: "",
};
const run: Run = {
  id: "r1", user_id: "u", experiment_id: "e1", name: "warmup=500", params: { lr: "3e-4" }, env: {},
  metrics: { acc: 0.9312 }, outcome: "Best so far", links: [{ label: "W&B", url: "https://wandb.ai/x" }],
  ran_at: "2026-11-02T09:00:00Z", created_at: "", updated_at: "",
};

describe("experimentToMarkdown", () => {
  const md = experimentToMarkdown({ experiment: exp, projectName: "ViT", snippets: [snip], runs: [run] });
  it("includes metadata, notes, code and runs", () => {
    expect(md).toContain("# LR warmup | ablation");
    expect(md).toContain("**Status:** Done");
    expect(md).toContain("**Project:** ViT");
    expect(md).toContain("`vit`, `cifar10`");
    expect(md).toContain("## Hypothesis");
    expect(md).toContain("| acc | 0.9312 |");
    expect(md).toContain("- [W&B](https://wandb.ai/x)");
  });
  it("uses a fence longer than any backticks in the code", () => {
    expect(md).toContain("````python\nprint('```')\n````");
  });
  it("makes a safe filename", () => {
    expect(exportFilename("LR warmup | ablation")).toBe("lr-warmup-ablation.md");
    expect(exportFilename("***")).toBe("experiment.md");
  });
});

describe("buildTsQuery", () => {
  it("builds prefix AND queries", () => {
    expect(buildTsQuery("lr sched")).toBe("lr:* & sched:*");
  });
  it("splits identifiers and strips tsquery syntax", () => {
    expect(buildTsQuery("learning_rate & !(drop')")).toBe("learning:* & rate:* & drop:*");
  });
  it("returns empty for punctuation only and dedupes", () => {
    expect(buildTsQuery("  &|! ")).toBe("");
    expect(buildTsQuery("adam Adam")).toBe("adam:*");
  });
});

describe("guessLanguage", () => {
  it("maps extensions", () => {
    expect(guessLanguage("train.py")).toBe("python");
    expect(guessLanguage("kernel.cu")).toBe("cpp");
    expect(guessLanguage("analysis.R")).toBe("r");
    expect(guessLanguage("solve.m")).toBe("matlab");
    expect(guessLanguage("README")).toBeNull();
  });
});
