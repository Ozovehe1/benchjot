// How Find datasets shows its results: a platform chip (name and count) and a dataset's row (title,
// platform, detail, Files). Presentational only, so the landing's showcase draws the very same.
import { cn } from "@/lib/ui/format";

export function PlatformChip({ label, count, on, onClick }: { label: string; count: number; on: boolean; onClick?: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors", on ? "bg-fg text-bg" : "bg-tint text-muted hover:text-fg")}>
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

export function DatasetRow({ title, platform, detail, open, onClick }: { title: string; platform: string; detail?: string; open: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-tint/50 sm:px-5" aria-expanded={open}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-fg">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-faint">
          <span className="text-muted">{platform}</span>
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted">{open ? "Hide" : "Files"}</span>
    </button>
  );
}
