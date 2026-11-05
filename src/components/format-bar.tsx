"use client";
// The note body's Markdown format bar: a slim, quiet row of 48px buttons shown above the
// body while it is being edited (sticky). Each button runs applyFormat (src/lib/markdown-format.ts).
import { MARKDOWN_FORMATS, type MarkdownFormat } from "@/lib/markdown-format";
import { cn } from "@/lib/format";

/** Glyph and name for each button, in MARKDOWN_FORMATS order. Same on Android (ui/FormatBar.kt). */
export const FORMAT_BUTTONS: Record<MarkdownFormat, { glyph: string; name: string; className?: string }> = {
  bold: { glyph: "B", name: "Bold", className: "font-semibold" },
  italic: { glyph: "I", name: "Italic", className: "italic font-serif" },
  heading: { glyph: "H", name: "Heading", className: "font-semibold" },
  list: { glyph: "•", name: "List" },
  code: { glyph: "<>", name: "Code", className: "font-mono text-xs" },
  math: { glyph: "∑", name: "Math" },
  link: { glyph: "[ ]", name: "Link", className: "font-mono text-xs" },
};

export function FormatBar({ onFormat }: { onFormat: (f: MarkdownFormat) => void }) {
  return (
    <div
      role="toolbar"
      aria-label="Format"
      // Keep focus (and the selection) in the textarea when a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
      className="sticky top-0 z-10 -mx-1 flex overflow-x-auto border-b border-line bg-bg"
    >
      {MARKDOWN_FORMATS.map((f) => (
        <button
          key={f}
          type="button"
          aria-label={FORMAT_BUTTONS[f].name}
          title={FORMAT_BUTTONS[f].name}
          onClick={() => onFormat(f)}
          className={cn("flex h-12 w-12 shrink-0 items-center justify-center text-sm text-muted transition-colors hover:text-fg", FORMAT_BUTTONS[f].className)}
        >
          {FORMAT_BUTTONS[f].glyph}
        </button>
      ))}
    </div>
  );
}
