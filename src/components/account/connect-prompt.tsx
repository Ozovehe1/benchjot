"use client";
// The call to connect, shown where the user starts something that needs a connection they don't
// have: Fix or the Assistant without AI (OpenRouter). Nothing is forced: it says what connecting gives,
// takes them straight there (and back to the same page), and can be put away.
import { usePathname } from "next/navigation";
import { ButtonLink, TextButton } from "../ui";

const COPY = {
  ai: {
    title: "This runs on your own free AI",
    text: "Fix and the assistant use a free OpenRouter account that belongs to you. Sign in there, tap Authorize, and you’re back here. About a minute, no card.",
    action: "Connect AI",
    href: "/api/ai-key/connect",
  },
} as const;

export type ConnectKind = keyof typeof COPY;

export function ConnectPrompt({ kind, onDismiss }: { kind: ConnectKind; onDismiss?: () => void }) {
  const path = usePathname() || "/";
  const c = COPY[kind];
  const href = `${c.href}?next=${encodeURIComponent(path)}`;
  return (
    <section aria-label={c.action} className="rounded-xl border border-line bg-tint/50 p-4">
      <h3 className="text-[15px] font-semibold text-fg">{c.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{c.text}</p>
      <div className="mt-3 flex items-center gap-5">
        <ButtonLink href={href} prefetch={false}>
          {c.action}
        </ButtonLink>
        {onDismiss && <TextButton onClick={onDismiss}>Not now</TextButton>}
      </div>
    </section>
  );
}
