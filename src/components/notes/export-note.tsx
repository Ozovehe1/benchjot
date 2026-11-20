"use client";
// "Export note" (the note's More menu): the whole note as a Jupyter notebook, one web page, or
// Markdown with its files (lib/files/note-export.ts), built in the browser from the note as saved
// and its runs' files, then downloaded. A native <dialog>: Escape and the backdrop close it.
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { EXPORT_FORMATS, exportBaseName, toMarkdownZip, toNotebook, toWebPage, type ExportFormat, type ExportNote } from "@/lib/files/note-export";
import { saveBlob } from "@/lib/files/save-file";
import { userMessage } from "@/lib/ui/user-message";
import { TextButton, Notice } from "../ui";

export type ExportNoteHandle = { open: () => void };

/** The web page's Markdown, rendered as the note screen renders it (tables, math), loaded only on export. */
async function markdownRenderer(): Promise<(md: string) => string> {
  const [{ renderToStaticMarkup }, { default: ReactMarkdown }, { default: remarkGfm }, { default: remarkMath }, { default: rehypeKatex }] = await Promise.all([
    import("react-dom/server"),
    import("react-markdown"),
    import("remark-gfm"),
    import("remark-math"),
    import("rehype-katex"),
  ]);
  return (md) => renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}>{md}</ReactMarkdown>);
}

async function build(format: ExportFormat, note: ExportNote): Promise<{ name: string; blob: Blob }> {
  const base = exportBaseName(note.title);
  if (format === "ipynb") return { name: `${base}.ipynb`, blob: new Blob([toNotebook(note)], { type: "application/x-ipynb+json" }) };
  if (format === "html") return { name: `${base}.html`, blob: new Blob([toWebPage(note, await markdownRenderer())], { type: "text/html;charset=utf-8" }) };
  return { name: `${base}.zip`, blob: new Blob([toMarkdownZip(note) as BlobPart], { type: "application/zip" }) };
}

export const ExportNoteDialog = forwardRef<ExportNoteHandle, { read: () => Promise<ExportNote> }>(function ExportNoteDialog({ read }, ref) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ open: () => { setError(null); dialog.current?.showModal(); } }), []);

  async function exportAs(format: ExportFormat) {
    setBusy(format);
    setError(null);
    try {
      const { name, blob } = await build(format, await read());
      saveBlob(name, blob);
      dialog.current?.close();
    } catch (e) {
      setError(userMessage(e, "download"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="export-title"
      onClick={(e) => e.target === dialog.current && !busy && dialog.current.close()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-bg p-0 text-fg shadow-float backdrop:bg-black/60"
    >
      <div className="p-6">
        <h2 id="export-title" className="font-display text-2xl font-medium tracking-[-0.01em]">Export note</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">The whole note: its text, every code cell with its notes, and the saved outputs.</p>
        <ul className="mt-4 space-y-2">
          {EXPORT_FORMATS.map((f) => (
            <li key={f.format}>
              <button
                type="button"
                onClick={() => void exportAs(f.format)}
                disabled={busy !== null}
                className="block w-full rounded-lg border border-line px-4 py-3 text-left transition-colors hover:bg-tint disabled:opacity-60"
              >
                <span className="block font-medium">{busy === f.format ? "Preparing…" : f.label}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{f.detail}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <Notice className="mt-3">{error}</Notice>}
      </div>
      <div className="flex justify-end border-t border-line px-3">
        <TextButton onClick={() => dialog.current?.close()} disabled={busy !== null} className="px-3">
          Close
        </TextButton>
      </div>
    </dialog>
  );
});
