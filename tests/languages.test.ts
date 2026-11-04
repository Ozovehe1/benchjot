import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, downloadName, languageChosen, languageConfig, languageFromFilename, LANGUAGES, symbolKeys } from "@/lib/languages";

describe("language config", () => {
  it("sets the indent style per language", () => {
    expect(languageConfig("python").indent).toBe("    ");
    expect(languageConfig("go").indent).toBe("\t");
    expect(languageConfig("javascript").indent).toBe("  ");
    expect(languageConfig("typescript").indent).toBe("  ");
  });
  it("sets the line-comment token per language", () => {
    expect(languageConfig("python").comment).toBe("#");
    expect(languageConfig("typescript").comment).toBe("//");
    expect(languageConfig("sql").comment).toBe("--");
    expect(languageConfig("matlab").comment).toBe("%");
    expect(languageConfig("json").comment).toBeNull();
  });
  it("offers language keywords for completion", () => {
    expect(languageConfig("python").keywords).toContain("def");
    expect(languageConfig("go").keywords).toContain("func");
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
    expect(symbolKeys("javascript").slice(0, 5)).toEqual(["Tab", "=>", "{", "}", ";"]);
    expect(symbolKeys("sql").slice(0, 5)).toEqual(["Tab", ";", "*", "'", ","]);
  });
  it("includes the common keys once each", () => {
    const keys = symbolKeys("javascript");
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["(", ")", "[", "]", "\\", "|", "_"]) expect(keys).toContain(k);
  });
});

describe("languageFromFilename", () => {
  it("maps extensions", () => {
    expect(languageFromFilename("train.py")).toBe("python");
    expect(languageFromFilename("utils.ts")).toBe("typescript");
    expect(languageFromFilename("main.go")).toBe("go");
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
    expect(downloadName("", "go", 1)).toBe("code-2.go");
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
    expect(languageChosen("javascript", "")).toBe(true);
    expect(languageChosen("python", "print(1)")).toBe(true);
    expect(languageChosen("text", "notes")).toBe(true);
  });
});
