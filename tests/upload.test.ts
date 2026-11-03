import { describe, expect, it } from "vitest";
import { looksBinary, MAX_UPLOAD_BYTES, notebookCode, prepareUpload } from "@/lib/upload";

const enc = (s: string) => new TextEncoder().encode(s);

describe("prepareUpload", () => {
  it("keeps the filename and sets language from the extension", () => {
    const r = prepareUpload("train.py", enc("x = 1\r\n"));
    expect(r).toEqual({ ok: true, file: { filename: "train.py", language: "python", content: "x = 1\n" } });
  });
  it("falls back to content detection, then plain text", () => {
    const go = prepareUpload("Makefile-ish", enc("package main\n\nfunc main() {\n}\n"));
    expect(go.ok && go.file.language).toBe("go");
    const txt = prepareUpload("notes", enc("just some words here"));
    expect(txt.ok && txt.file.language).toBe("text");
  });
  it("rejects files over 1 MB", () => {
    const r = prepareUpload("big.csv", new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(97));
    expect(r).toEqual({ ok: false, error: "big.csv is over 1 MB." });
    expect(prepareUpload("ok.txt", new Uint8Array(MAX_UPLOAD_BYTES).fill(97)).ok).toBe(true);
  });
  it("rejects binaries", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(prepareUpload("img.png", png)).toEqual({ ok: false, error: "img.png isn’t a text file." });
  });
  it("extracts code cells from a notebook", () => {
    const nb = JSON.stringify({ cells: [{ cell_type: "markdown", source: ["# hi"] }, { cell_type: "code", source: ["import torch\n", "x = 1"] }, { cell_type: "code", source: "print(x)" }] });
    const r = prepareUpload("exp.ipynb", enc(nb));
    expect(r).toEqual({ ok: true, file: { filename: "exp.ipynb", language: "python", content: "import torch\nx = 1\n\n# %%\nprint(x)" } });
  });
});

describe("guards", () => {
  it("looksBinary: text with tabs and newlines is not binary", () => {
    expect(looksBinary(enc("a\tb\nc\r\n"))).toBe(false);
    expect(looksBinary(new Uint8Array([104, 0, 105]))).toBe(true);
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });
  it("notebookCode returns null for non-notebooks", () => {
    expect(notebookCode("not json")).toBeNull();
    expect(notebookCode("{}")).toBeNull();
  });
});
