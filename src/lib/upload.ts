// Turns an uploaded file into a code block: size and binary guard, UTF-8
// decode, language from the extension, then from the content, then plain text.
// Pure (bytes in, result out) so it is unit-tested without a browser.
import { detectLanguage } from "./detect-language";
import { languageFromFilename, type LanguageId } from "./languages";

export const MAX_UPLOAD_BYTES = 1024 * 1024;

export interface CodeFile {
  filename: string;
  language: LanguageId;
  content: string;
}

export type UploadResult = { ok: true; file: CodeFile } | { ok: false; error: string };

/** True when the bytes look like a binary file (NUL byte, or many control characters, in the first 8 KB). */
export function looksBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  let control = 0;
  for (const b of head) {
    if (b === 0) return true;
    if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12) control++;
  }
  return head.length > 0 && control / head.length > 0.1;
}

/** Code cells of a Jupyter notebook, joined with "# %%" separators; null if it isn't one. */
export function notebookCode(text: string): string | null {
  try {
    const nb = JSON.parse(text) as { cells?: { cell_type?: string; source?: string | string[] }[] };
    if (!Array.isArray(nb.cells)) return null;
    return nb.cells
      .filter((c) => c.cell_type === "code")
      .map((c) => (Array.isArray(c.source) ? c.source.join("") : (c.source ?? "")).trimEnd())
      .filter(Boolean)
      .join("\n\n# %%\n");
  } catch {
    return null;
  }
}

const cleanName = (filename: string) => filename.trim().slice(0, 200) || "untitled";
const tooLarge = (name: string): UploadResult => ({ ok: false, error: `${name} is over 1 MB.` });

export function prepareUpload(filename: string, bytes: Uint8Array): UploadResult {
  const name = cleanName(filename);
  if (bytes.length > MAX_UPLOAD_BYTES) return tooLarge(name);
  if (looksBinary(bytes)) return { ok: false, error: `${name} isn’t a text file.` };
  let content = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/\.ipynb$/i.test(name)) {
    const code = notebookCode(content);
    if (code === null) return { ok: false, error: `${name} isn’t a valid notebook.` };
    content = code;
  }
  const language = languageFromFilename(name) ?? detectLanguage(content) ?? "text";
  return { ok: true, file: { filename: name, language, content } };
}

/** Browser side: read File objects and prepare each; files over the limit are rejected before reading. */
export async function readCodeFiles(files: Iterable<File>): Promise<{ files: CodeFile[]; errors: string[] }> {
  const out: CodeFile[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const r = f.size > MAX_UPLOAD_BYTES ? tooLarge(cleanName(f.name)) : prepareUpload(f.name, new Uint8Array(await f.arrayBuffer()));
    if (r.ok) out.push(r.file);
    else errors.push(r.error);
  }
  return { files: out, errors };
}
