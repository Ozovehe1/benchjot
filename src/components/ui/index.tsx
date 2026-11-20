// The few shared pieces of UI: a centred column, the logo, a top bar, and buttons.
// Every tap target is at least 48px tall.
import * as React from "react";
import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { MARK } from "@/lib/ui/brand";
import { cn } from "@/lib/ui/format";

export function Column({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[720px] px-5 sm:px-8 xl:max-w-[840px]", className)}>{children}</div>;
}

/** The mark from src/lib/ui/brand.ts, the same drawing the icons are made from, in the text colour (no tile). */
function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const v = MARK.viewBox;
  const c = MARK.cursor;
  return (
    <svg viewBox={`0 0 ${v} ${v}`} width={size} height={size} aria-hidden className={cn("shrink-0 text-fg", className)}>
      {MARK.paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={MARK.stroke} strokeLinecap="square" />
      ))}
      <rect x={c.x} y={c.y} width={c.width} height={c.height} fill="currentColor" />
    </svg>
  );
}

/** Mark plus wordmark, linking home. `compact` drops the wordmark (narrow headers). */
export function Logo({ compact = false, size = 28 }: { compact?: boolean; size?: number }) {
  return (
    <Link href="/" aria-label={`${APP_NAME} home`} className="-ml-1 inline-flex min-h-12 min-w-12 items-center gap-2.5 px-1">
      <LogoMark size={size} />
      {!compact && <span className="font-mono text-[15px] font-semibold tracking-tight text-fg">{APP_NAME.toLowerCase()}</span>}
    </Link>
  );
}

/** Header: logo (optionally followed by a breadcrumb) on the left, actions on the right. Inside the
 *  app shell on desktop the sidebar carries the logo, so it hides here (`shell-hide`, globals.css). */
export function TopBar({ left, right, compact }: { left?: React.ReactNode; right?: React.ReactNode; compact?: boolean }) {
  return (
    <header className="flex h-16 items-center justify-between gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shell-hide">
          <Logo compact={compact ?? Boolean(left)} />
        </span>
        {left && <span className="min-w-0 truncate">{left}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-4">{right}</div>
    </header>
  );
}

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-fg/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
// Text actions keep their text where it was (the padding is given back by the margin) and show a soft pill on hover.
const textBase = `-mx-2 inline-flex min-h-12 items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 hover:bg-tint/70 hover:text-fg active:bg-tint disabled:pointer-events-none disabled:opacity-45 ${focusRing}`;
const textTone = (strong?: boolean) => (strong ? "font-medium text-fg" : "text-muted");
const filledBase = `relative inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 aria-busy:cursor-progress ${focusRing}`;
/** md: a screen's main action; sm: an action at the end of a row (still a 44 px touch target). */
const filledSize = { md: "h-12 px-5 text-[15px]", sm: "h-11 px-4 text-sm" } as const;
const filledTone = {
  // A flat fill in the text colour; a step lighter under the pointer.
  primary: "bg-fg text-bg hover:bg-fg/90",
  // A second action beside the primary one: a quiet filled surface.
  soft: "border border-line bg-tint text-fg hover:border-faint hover:bg-line/60",
  // Stop-style toggles: outlined.
  neutral: "border border-faint/70 bg-bg text-fg hover:border-muted hover:bg-tint",
} as const;

/** A text field: a rounded, lightly filled box that clears to the page colour while typing. */
export const FIELD =
  "block h-12 w-full rounded-lg border border-line bg-tint/40 px-3.5 outline-none transition-colors placeholder:text-faint focus:border-faint focus:bg-transparent";

type Strong = { strong?: boolean };
type Variant = { variant?: keyof typeof filledTone; size?: keyof typeof filledSize };

/** A small ring that turns while something is under way; the text beside it says what. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={cn("size-4 shrink-0 animate-spin motion-reduce:animate-none", className)} fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Work in progress, said in words: a spinner and a label ("Thinking…"), announced politely. */
export function Working({ label, detail, className }: { label: string; detail?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex min-h-8 items-center gap-2.5 text-sm", className)}>
      <Spinner className="text-muted" />
      <span className="min-w-0 truncate text-muted">{label}</span>
      {detail && <span className="shrink-0 font-mono text-xs text-faint">{detail}</span>}
    </div>
  );
}

/** Secondary actions: text only. `strong` for a selected or emphasised one. */
export function TextButton({ className, strong, type = "button", ...rest }: React.ComponentProps<"button"> & Strong) {
  return <button type={type} className={cn(textBase, textTone(strong), className)} {...rest} />;
}

export function TextLink({ className, strong, ...rest }: React.ComponentProps<typeof Link> & Strong) {
  return <Link className={cn(textBase, textTone(strong), className)} {...rest} />;
}

/**
 * The one primary action on a screen (filled ash on charcoal); `soft` for the action beside it,
 * `neutral` (outlined) for a stop-style toggle. `loading` shows a spinner and holds the button.
 */
export function Button({ className, variant = "primary", size = "md", type = "button", loading, disabled, children, ...rest }: React.ComponentProps<"button"> & Variant & { loading?: boolean }) {
  return (
    <button type={type} aria-busy={loading || undefined} disabled={disabled || loading} className={cn(filledBase, filledSize[size], filledTone[variant], loading && "disabled:opacity-80", className)} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function ButtonLink({ className, variant = "primary", size = "md", ...rest }: React.ComponentProps<typeof Link> & Variant) {
  return <Link className={cn(filledBase, filledSize[size], filledTone[variant], className)} {...rest} />;
}

/** A segmented control (one choice of a few): a hairline track, the chosen one raised on a tint. */
export function Segmented<T>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string; name?: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-lg border border-line p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.name ?? o.label}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md px-3 text-xs transition-colors",
              on ? "bg-line font-medium text-fg" : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** An outcome as a small pill: Successful (a check) or Failed (a cross, in the failure colour). */
export function OutcomeBadge({ outcome }: { outcome: "success" | "failed" }) {
  const ok = outcome === "success";
  return (
    <span className={cn("shrink-0 text-xs", ok ? "text-muted" : "font-medium text-fail")}>{ok ? "Successful" : "Failed"}</span>
  );
}

type MenuItem = { label: string; href?: string; onSelect?: () => void; disabled?: boolean };

/** Overflow menu (⋮) for occasional actions. Closes on Escape, outside tap, or a choice; 48 px rows. */
export function MoreMenu({ items, label = "More" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const row = "flex min-h-12 w-full items-center rounded-md px-3 text-left text-sm text-fg transition-colors hover:bg-tint disabled:opacity-50";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(textBase, textTone(open), "min-w-12 justify-center text-lg")}>
        <span aria-hidden>⋮</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 min-w-48 overflow-hidden rounded-lg border border-line bg-bg p-1 shadow-[0_8px_30px_rgb(0_0_0/0.35)]">
          {items.map((it) =>
            it.href ? (
              <Link key={it.label} role="menuitem" href={it.href} className={row} onClick={() => setOpen(false)}>{it.label}</Link>
            ) : (
              <button key={it.label} type="button" role="menuitem" disabled={it.disabled} className={row} onClick={() => { setOpen(false); it.onSelect?.(); }}>{it.label}</button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
export { Notice, type NoticeAction } from "./notice";
export * from "./icons";
