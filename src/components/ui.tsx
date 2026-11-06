// The few shared pieces of UI: a centred column, the logo, a top bar, and buttons.
// Every tap target is at least 48px tall.
import * as React from "react";
import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { MARK } from "@/lib/brand";
import { cn } from "@/lib/format";

export function Column({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[720px] px-5 sm:px-8", className)}>{children}</div>;
}

/** The mark from src/lib/brand.ts, the same drawing the icons are made from, in the text colour (no tile). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
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

/** Header: logo (optionally followed by a breadcrumb) on the left, actions on the right. */
export function TopBar({ left, right, compact }: { left?: React.ReactNode; right?: React.ReactNode; compact?: boolean }) {
  return (
    <header className="flex h-16 items-center justify-between gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Logo compact={compact ?? Boolean(left)} />
        {left && <span className="min-w-0 truncate">{left}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-4">{right}</div>
    </header>
  );
}

const textBase = "inline-flex min-h-12 items-center text-sm transition-colors hover:text-fg disabled:opacity-50";
const textTone = (strong?: boolean) => (strong ? "text-fg" : "text-muted");
const filledBase = "inline-flex h-12 items-center justify-center rounded-md px-5 text-[15px] font-medium transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50";
const filledTone = { primary: "bg-fg text-bg", neutral: "border border-muted text-fg" } as const;

type Strong = { strong?: boolean };
type Variant = { variant?: keyof typeof filledTone };

/** Secondary actions: text only. `strong` for a selected or emphasised one. */
export function TextButton({ className, strong, type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & Strong) {
  return <button type={type} className={cn(textBase, textTone(strong), className)} {...rest} />;
}

export function TextLink({ className, strong, ...rest }: React.ComponentProps<typeof Link> & Strong) {
  return <Link className={cn(textBase, textTone(strong), className)} {...rest} />;
}

/** The one primary action on a screen (filled ash on charcoal). `neutral` (outlined) for a stop-style toggle. */
export function Button({ className, variant = "primary", type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & Variant) {
  return <button type={type} className={cn(filledBase, filledTone[variant], className)} {...rest} />;
}

export function ButtonLink({ className, variant = "primary", ...rest }: React.ComponentProps<typeof Link> & Variant) {
  return <Link className={cn(filledBase, filledTone[variant], className)} {...rest} />;
}

/** A plain text segmented control (one choice of a few): the chosen one reads in full text colour. */
export function Segmented<T>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string; name?: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex items-center gap-4", className)}>
      {options.map((o) => (
        <TextButton
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.name ?? o.label}
          strong={o.value === value}
          onClick={() => o.value !== value && onChange(o.value)}
          className="text-xs"
        >
          {o.label}
        </TextButton>
      ))}
    </div>
  );
}

// Same marks as the map (lib/graph.ts): a filled circle for successful, a diamond for failed,
// so the outcome never rests on colour alone (WCAG 1.4.1).
const dotTone = { success: "size-1.5 rounded-full bg-ok", failed: "size-1.5 rotate-45 bg-fail" } as const;

/** The list's tiny outcome mark (filled circle = successful, muted red diamond = failed); named for screen readers. */
export function OutcomeDot({ outcome, name }: { outcome: keyof typeof dotTone; name: string }) {
  return <span role="img" aria-label={name} title={name} className={cn("inline-block shrink-0", dotTone[outcome])} />;
}

export type MenuItem = { label: string; href?: string; onSelect?: () => void; disabled?: boolean };

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
  const row = "flex min-h-12 w-full items-center px-4 text-left text-sm text-fg hover:bg-tint disabled:opacity-50";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(textBase, textTone(open), "min-w-12 justify-center text-lg")}>
        <span aria-hidden>⋮</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 min-w-44 overflow-hidden rounded-md border border-line bg-bg py-1 shadow-lg">
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
