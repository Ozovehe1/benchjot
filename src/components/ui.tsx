"use client";
// Small, dependency-free UI primitives. All tap targets are >= 44px on touch.
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-strong font-semibold",
  secondary: "bg-surface-2 text-fg border border-border hover:bg-surface-3",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-danger-soft text-danger hover:bg-danger/20 font-medium",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-11 px-4 text-[15px] md:h-10 md:text-sm" : "h-9 px-3 text-sm md:h-8",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, variant = "ghost", children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40 md:size-9",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

const fieldBase =
  "w-full rounded-xl border border-border bg-surface-2 px-3.5 text-fg placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, "h-11 md:h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2.5 leading-relaxed", className)} {...rest} />;
  },
);

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "h-11 appearance-none pr-8 md:h-10", className)} {...rest}>
      {children}
    </select>
  );
}

export function Label({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-muted">
      <span>{children}</span>
      {hint && <span className="text-xs font-normal text-faint">{hint}</span>}
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted", className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1 text-danger/80">{error instanceof Error ? error.message : String(error)}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Chip({
  active,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors",
        active ? "border-accent/50 bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-muted">
      #{children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>
  );
}
