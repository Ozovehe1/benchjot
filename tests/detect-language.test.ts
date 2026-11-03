import { describe, expect, it } from "vitest";
import { detectLanguage } from "@/lib/detect-language";

describe("detectLanguage", () => {
  const cases: [string, string][] = [
    ["python", "import torch\n\ndef step(x):\n    return x * 2\n"],
    ["javascript", "const add = (a, b) => a + b;\nconsole.log(add(1, 2));\n"],
    ["typescript", "interface Run {\n  lr: number;\n}\nconst r: Run = { lr: 1 };\n"],
    ["go", "package main\n\nfunc main() {\n\tx := 1\n}\n"],
    ["cpp", "#include <vector>\nstd::vector<int> v;\n"],
    ["c", "#include <stdio.h>\nint main(void) { printf(\"hi\"); }\n"],
    ["sql", "SELECT id, title FROM entries WHERE id = 1;"],
    ["json", "{\"lr\": 0.001, \"epochs\": 10}"],
    ["bash", "#!/bin/bash\necho hello\n"],
    ["r", "library(dplyr)\nx <- c(1, 2, 3)\n"],
    ["yaml", "model: vit\nlr: 0.001\nepochs: 10\n"],
  ];
  it.each(cases)("detects %s", (lang, code) => {
    expect(detectLanguage(code)).toBe(lang);
  });
  it("returns null for too little or unclear text", () => {
    expect(detectLanguage("x")).toBeNull();
    expect(detectLanguage("just some words here")).toBeNull();
  });
});
