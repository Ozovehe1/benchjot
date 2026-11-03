// The few shared pieces of UI: a centred column, a top bar, and text buttons.
import Link from "next/link";
import { cn } from "@/lib/format";

export function Column({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[720px] px-5 sm:px-8", className)}>{children}</div>;
}

export function TopBar({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="flex h-14 items-center justify-between gap-4 text-sm">
      <div className="flex min-w-0 items-center gap-5">{left}</div>
      <div className="flex shrink-0 items-center gap-5">{right}</div>
    </header>
  );
}

const textButton = "inline-flex min-h-11 items-center text-sm text-muted transition-colors hover:text-fg disabled:opacity-50";

export function TextButton({ className, type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(textButton, className)} {...rest} />;
}

export function TextLink({ className, ...rest }: React.ComponentProps<typeof Link>) {
  return <Link className={cn(textButton, className)} {...rest} />;
}
