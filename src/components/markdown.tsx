// No "use client": server components render it with no client JS (the landing
// preview); client components (the editor) bundle it as usual.
import { useMemo } from "react";
import Link from "next/link";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { NoteRef } from "@/lib/links";
import { remarkNoteLinks } from "@/lib/remark-note-links";

/** Renders a note body. `notes` resolves [[note links]]: they open the note, or read muted if it's gone. */
export function Markdown({ children, notes = [] }: { children: string; notes?: readonly NoteRef[] }) {
  const remarkPlugins = useMemo<Options["remarkPlugins"]>(() => [remarkGfm, remarkMath, [remarkNoteLinks, { notes }]], [notes]);
  return (
    <div className="prose-notes">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
        components={{
          a: ({ node: _node, href, children: label, ...props }) => {
            const note = (props as Record<string, unknown>)["data-note"];
            if (note === "missing") return <span className="note-link-missing" title="No such note">{label}</span>;
            if (typeof note === "string" && href) return <Link href={href} className="note-link">{label}</Link>;
            return <a {...props} href={href} target="_blank" rel="noreferrer noopener">{label}</a>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
