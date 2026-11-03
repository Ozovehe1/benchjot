"use client";
import { STATUSES, STATUS_LABEL, type Status } from "@/lib/schemas";
import { cn } from "@/lib/format";

export const STATUS_STYLE: Record<Status, { dot: string; badge: string }> = {
  planned: { dot: "bg-slate-400", badge: "text-slate-300 bg-slate-400/12" },
  running: { dot: "bg-sky-400 animate-pulse", badge: "text-sky-300 bg-sky-400/12" },
  done: { dot: "bg-emerald-400", badge: "text-emerald-300 bg-emerald-400/12" },
  failed: { dot: "bg-rose-400", badge: "text-rose-300 bg-rose-400/12" },
  abandoned: { dot: "bg-zinc-500", badge: "text-zinc-400 bg-zinc-500/12" },
};

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_STYLE[status].dot, className)} aria-hidden />;
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "status-badge inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        STATUS_STYLE[status].badge,
      )}
      data-status={status}
    >
      <StatusDot status={status} className="size-1.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusPicker({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-2">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors md:h-9",
            value === s ? "border-accent/50 bg-accent-soft text-fg" : "border-border text-muted hover:text-fg",
          )}
        >
          <StatusDot status={s} />
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}
