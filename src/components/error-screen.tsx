// The full-page screens for a crash and a missing page (app/error.tsx, global-error.tsx,
// not-found.tsx). Never shows the error itself: the raw error goes to the console only.
import { Button, ButtonLink, Column, TopBar } from "./ui";

export const SCREEN_TEXT = {
  crash: { title: "Something went wrong", body: "This page hit a problem. Try again, or go back home." },
  missing: { title: "Page not found", body: "This page doesn’t exist or was moved." },
} as const;

export function ErrorScreen({ kind, onRetry }: { kind: keyof typeof SCREEN_TEXT; onRetry?: () => void }) {
  const t = SCREEN_TEXT[kind];
  return (
    <Column>
      <TopBar />
      <main className="py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{t.title}</h1>
        <p className="mt-3 text-muted">{t.body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
          <ButtonLink href="/" variant={onRetry ? "neutral" : "primary"}>
            Go home
          </ButtonLink>
        </div>
      </main>
    </Column>
  );
}
