// Which of a cell's imports the server installs from PyPI (src/lib/run/python-imports.ts).
import { describe, expect, it } from "vitest";
import { distributionFor, missingDistributions, topLevelImports } from "@/lib/run/python-imports";

describe("topLevelImports", () => {
  it("reads import and from lines, top-level names once, no relative imports", () => {
    const code = "import numpy as np, pandas\nfrom sklearn.model_selection import train_test_split\nimport a.b.c\nfrom . import x\nfrom .y import z\n  import indented  # comment\nx = 1; import semi\n# import commented\nimport numpy\n";
    expect(topLevelImports(code)).toEqual(["numpy", "pandas", "sklearn", "a", "indented", "semi"]);
  });
});

describe("missingDistributions", () => {
  it("skips the standard library and everything the image has (directly or as a dependency)", () => {
    const code = "import os, sys, json, asyncio, __future__\nimport tensorflow, keras, torch, jax, sklearn, cv2, PIL, yaml, prophet, shap, xgboost\nimport requests, tqdm, scipy, matplotlib.pyplot\n";
    expect(missingDistributions(code)).toEqual([]);
  });
  it("maps import names to PyPI names", () => {
    expect(distributionFor("sklearn_extra")).toBe("scikit-learn-extra");
    expect(distributionFor("Bio")).toBe("biopython");
    expect(distributionFor("einops")).toBe("einops");
    expect(missingDistributions("import Bio\nimport einops\nimport faiss")).toEqual(["biopython", "einops", "faiss-cpu"]);
  });
  it("leaves out what # pip: already asks for, whatever its spelling or version", () => {
    expect(missingDistributions("import einops\nimport sklearn_extra", ["Einops==0.8.0", "scikit_learn_extra"])).toEqual([]);
  });
  it("keeps at most `max`", () => {
    expect(missingDistributions("import aa1\nimport aa2\nimport aa3", [], 2)).toEqual(["aa1", "aa2"]);
  });
});
