// The few shared pieces of UI: a centred column, the logo, a top bar, and buttons.
// Every tap target is at least 48px tall.
import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { BRAND, MARK } from "@/lib/brand";
import { cn } from "@/lib/format";

export function Column({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[720px] px-5 sm:px-8", className)}>{children}</div>;
}

/** The mark from src/lib/brand.ts; the same drawing the icons are made from. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const v = MARK.viewBox;
  const c = MARK.cursor;
  return (
    <svg viewBox={`0 0 ${v} ${v}`} width={size} height={size} aria-hidden className={cn("shrink-0", className)}>
      <rect width={v} height={v} rx={MARK.radius} fill={BRAND.accent} />
      {MARK.paths.map((d) => (
        <path key={d} d={d} fill="none" stroke={BRAND.ink} strokeWidth={MARK.stroke} strokeLinecap="square" />
      ))}
      <rect x={c.x} y={c.y} width={c.width} height={c.height} fill={BRAND.ink} />
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
const filledTone = { primary: "bg-accent text-accent-ink", neutral: "bg-fg text-bg" } as const;

type Strong = { strong?: boolean };
type Variant = { variant?: keyof typeof filledTone };

/** Secondary actions: text only. `strong` for a selected or emphasised one. */
export function TextButton({ className, strong, type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & Strong) {
  return <button type={type} className={cn(textBase, textTone(strong), className)} {...rest} />;
}

export function TextLink({ className, strong, ...rest }: React.ComponentProps<typeof Link> & Strong) {
  return <Link className={cn(textBase, textTone(strong), className)} {...rest} />;
}

/** The one primary action on a screen (filled, accent). `neutral` for a stop-style toggle. */
export function Button({ className, variant = "primary", type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & Variant) {
  return <button type={type} className={cn(filledBase, filledTone[variant], className)} {...rest} />;
}

export function ButtonLink({ className, variant = "primary", ...rest }: React.ComponentProps<typeof Link> & Variant) {
  return <Link className={cn(filledBase, filledTone[variant], className)} {...rest} />;
}
