import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, downloadName, languageChosen, languageConfig, languageFromFilename, LANGUAGES, symbolKeys } from "@/lib/code/languages";

describe("language config", () => {
  it("sets the indent style per language", () => {
    expect(languageConfig("python").indent).toBe("    ");
    expect(languageConfig("fortran").indent).toBe("  ");
    expect(languageConfig("r").indent).toBe("  ");
  });
  it("sets the line-comment token per language", () => {
    expect(languageConfig("python").comment).toBe("#");
    expect(languageConfig("cpp").comment).toBe("//");
    expect(languageConfig("sql").comment).toBe("--");
    expect(languageConfig("matlab").comment).toBe("%");
    expect(languageConfig("json").comment).toBeNull();
  });
  it("offers language keywords for completion", () => {
    expect(languageConfig("python").keywords).toContain("def");
    expect(languageConfig("julia").keywords).toContain("function");
    expect(languageConfig("sql").keywords).toContain("select");
  });
  it("falls back to plain text for unknown ids", () => {
    expect(languageConfig("cobol").id).toBe("text");
  });
  it("gives every language a unique id and at least one extension", () => {
    expect(new Set(LANGUAGES.map((l) => l.id)).size).toBe(LANGUAGES.length);
    for (const l of LANGUAGES) expect(l.ext.length).toBeGreaterThan(0);
  });
});

describe("symbolKeys", () => {
  it("starts with Tab, then the language's own keys", () => {
    expect(symbolKeys("python").slice(0, 5)).toEqual(["Tab", ":", "#", "_", "self"]);
    expect(symbolKeys("r").slice(0, 5)).toEqual(["Tab", "<-", "%>%", "#", "$"]);
    expect(symbolKeys("sql").slice(0, 5)).toEqual(["Tab", ";", "*", "'", ","]);
  });
  it("includes the common keys once each", () => {
    const keys = symbolKeys("r");
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["(", ")", "[", "]", "\\", "|", "_"]) expect(keys).toContain(k);
  });
});

describe("languageFromFilename", () => {
  it("maps extensions", () => {
    expect(languageFromFilename("train.py")).toBe("python");
    expect(languageFromFilename("model.R")).toBe("r");
    expect(languageFromFilename("utils.ts")).toBeNull(); // web languages aren't the app's
    expect(languageFromFilename("main.go")).toBeNull(); // not a language here
    expect(languageFromFilename("kernel.cu")).toBe("cpp");
    expect(languageFromFilename("analysis.R")).toBe("r");
    expect(languageFromFilename("solve.m")).toBe("matlab");
    expect(languageFromFilename("query.SQL")).toBe("sql");
    expect(languageFromFilename("exp.ipynb")).toBe("python");
  });
  it("returns null without a known extension", () => {
    expect(languageFromFilename("README")).toBeNull();
    expect(languageFromFilename("photo.png")).toBeNull();
  });
});

describe("downloadName", () => {
  it("keeps an uploaded name, otherwise uses the language's extension", () => {
    expect(downloadName("train.py", "python", 0)).toBe("train.py");
    expect(downloadName("", "julia", 1)).toBe("code-2.jl");
    expect(downloadName("", "text", 0)).toBe("code-1.txt");
  });
});

describe("default language", () => {
  it("is Python for new code blocks", () => {
    expect(DEFAULT_LANGUAGE).toBe("python");
  });
  it("leaves an empty default (or old plain-text) block open to detection", () => {
    expect(languageChosen("python", "")).toBe(false);
    expect(languageChosen("text", "  ")).toBe(false);
  });
  it("keeps a picked language or saved code as chosen", () => {
    expect(languageChosen("r", "")).toBe(true);
    expect(languageChosen("python", "print(1)")).toBe(true);
    expect(languageChosen("text", "notes")).toBe(true);
  });
});

describe("the language picker (scientific languages only)", async () => {
  const { pickerLanguages, PICKER_LANGUAGE_IDS, languageFromFilename } = await import("@/lib/code/languages");
  const { detectCellLanguage, detectLanguage } = await import("@/lib/code/detect-language");
  const ids = (cur: string) => pickerLanguages(cur).map((l) => l.id);

  it("offers science, data science and ML languages, Python first; no web or systems languages", () => {
    expect(ids("python")).toEqual([...PICKER_LANGUAGE_IDS]);
    expect(ids("python")[0]).toBe("python");
    for (const gone of ["go", "rust", "java"]) expect(ids("python")).not.toContain(gone);
    for (const kept of ["r", "julia", "matlab", "sql", "cpp", "c", "fortran"]) expect(ids("python")).toContain(kept);
  });

  it("a cell in a language the app no longer has reads as plain text; the picker is the same for it", () => {
    expect(languageConfig("go").id).toBe("text"); // a cell saved in a language the app no longer has reads as plain text
    expect(ids("go")).toEqual([...PICKER_LANGUAGE_IDS]);
    expect(ids("not-a-language")).toEqual([...PICKER_LANGUAGE_IDS]);
  });

  it("typing or pasting picks only picker languages", () => {
    expect(detectCellLanguage("const x = 1;\nconsole.log(x);")).toBeNull(); // web script: not a language here
    expect(detectLanguage("const x = 1;\nconsole.log(x);")).toBeNull();
    expect(detectLanguage("package main\n\nfunc main() {\n\tx := 1\n}\n")).toBeNull();
    expect(detectCellLanguage("package main\n\nfunc main() {\n\tx := 1\n}\n")).toBeNull();
    expect(detectCellLanguage("library(dplyr)\nx <- c(1, 2)")).toBe("r");
    expect(detectCellLanguage("import numpy as np\nprint(np.pi)")).toBe("python");
  });

  it("Fortran: detected, uploaded by extension, highlighted", () => {
    expect(detectCellLanguage("program heat\n  implicit none\n  real :: t\nend program heat")).toBe("fortran");
    expect(languageFromFilename("solver.f90")).toBe("fortran");
  });
});
