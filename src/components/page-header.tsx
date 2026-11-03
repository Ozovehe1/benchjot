"use client";
import Link from "next/link";
import { AlertCircle, Check, ChevronLeft, CloudUpload } from "lucide-react";
import { useSaveStatus } from "@/lib/autosave";
import { cn } from "@/lib/format";

export function PageHeader({
  title,
  back,
  actions,
  showSave,
  narrow,
  children,
}: {
  title?: React.ReactNode;
  back?: string;
  actions?: React.ReactNode;
  showSave?: boolean;
  /** Match a max-w-3xl content column (detail pages). */
  narrow?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur-lg">
      <div className={cn("mx-auto flex h-14 items-center gap-1 px-2 md:h-16 md:px-6", narrow ? "max-w-3xl" : "max-w-5xl")}>
        {back && (
          <Link
            href={back}
            aria-label="Back"
            className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg md:-ml-2 md:size-9"
          >
            <ChevronLeft className="size-5" />
          </Link>
        )}
        <div className={cn("min-w-0 flex-1", !back && "pl-2 md:pl-0")}>
          {typeof title === "string" ? <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1> : title}
        </div>
        {showSave && <SaveIndicator />}
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function SaveIndicator() {
  const { state, error, flushAll } = useSaveStatus();
  if (state === "idle") return null;
  const content = {
    pending: { icon: <CloudUpload className="size-3.5" />, text: "Unsaved", cls: "text-faint" },
    saving: { icon: <CloudUpload className="size-3.5 animate-pulse" />, text: "Saving…", cls: "text-muted" },
    saved: { icon: <Check className="size-3.5" />, text: "Saved", cls: "text-accent" },
    error: { icon: <AlertCircle className="size-3.5" />, text: "Retry save", cls: "text-danger" },
  }[state];
  return (
    <button
      type="button"
      onClick={() => void flushAll()}
      title={error ?? "Saves automatically · Ctrl+S"}
      aria-live="polite"
      className={cn("mr-1 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium", content.cls)}
    >
      {content.icon}
      {content.text}
    </button>
  );
}
