"use client";
// How the app says something went wrong (or needs attention) in place: a soft panel with a mark,
// the message in plain words (lib/ui/user-message.ts), and the next step as buttons (Try again,
// Sign in, Dismiss). Announced to screen readers: errors at once, information politely.
import { cn } from "@/lib/ui/format";

export type NoticeAction = { label: string; onClick: () => void; primary?: boolean };

export function Notice({
  children,
  tone = "error",
  actions = [],
  onDismiss,
  compact,
  className,
}: {
  children: React.ReactNode;
  tone?: "error" | "info";
  actions?: readonly NoticeAction[];
  onDismiss?: () => void;
  /** One line inside a row (no panel), for tight places such as a note's settings rows. */
  compact?: boolean;
  className?: string;
}) {
  const role = tone === "error" ? "alert" : "status";
  if (compact)
    return (
      <span role={role} className={cn("inline-flex items-center gap-1.5 text-sm text-fg", className)}>
        <Mark tone={tone} small />
        {children}
      </span>
    );
  return (
    <div
      role={role}
      className={cn(
        "flex gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed",
        tone === "error" ? "border-fail/35 bg-fail/[0.07] text-fg" : "border-line bg-tint/60 text-fg",
        className,
      )}
    >
      <Mark tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="break-words">{children}</div>
        {(actions.length > 0 || onDismiss) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className={cn(
                  "-mx-1.5 min-h-10 rounded-md px-1.5 text-sm underline-offset-4 transition-colors hover:bg-tint hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40",
                  a.primary !== false ? "font-medium text-fg" : "text-muted",
                )}
              >
                {a.label}
              </button>
            ))}
            {onDismiss && (
              <button type="button" onClick={onDismiss} className="-mx-1.5 min-h-10 rounded-md px-1.5 text-sm text-muted transition-colors hover:bg-tint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40">
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Mark({ tone, small }: { tone: "error" | "info"; small?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn("shrink-0", small ? "size-4" : "mt-0.5 size-[18px]", tone === "error" ? "text-fail" : "text-muted")} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="10" cy="10" r="7.5" />
      {tone === "error" ? (
        <>
          <path d="M10 6.2v4.6" />
          <circle cx="10" cy="13.6" r="0.4" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M10 9v4.8" />
          <circle cx="10" cy="6.4" r="0.4" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
