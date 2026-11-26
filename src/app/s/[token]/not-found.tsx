import type { Metadata } from "next";
import { ButtonLink, Column, TopBar } from "@/components/ui";

export const metadata: Metadata = { title: "Link not active", robots: { index: false, follow: false } };

// A shared link that doesn't open a note: never made, stopped, reset, or past its end date. It says
// so without telling which (that is the owner's business), and what to do.
export default function SharedLinkNotFound() {
  return (
    <Column>
      <TopBar />
      <main className="py-16">
        <h1 className="text-2xl font-medium tracking-tight text-fg">This link isn’t active</h1>
        <p className="mt-3 max-w-prose text-muted">The note’s owner may have stopped sharing it, made a new link, or set this one to end. Ask them for a new link.</p>
        <div className="mt-8">
          <ButtonLink href="/">Go to Benchjot</ButtonLink>
        </div>
      </main>
    </Column>
  );
}
