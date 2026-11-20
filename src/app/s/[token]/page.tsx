import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NotePreview } from "@/components/notes/note-preview";
import { SharedActions, SharedViewCount } from "@/components/share/shared-actions";
import { ButtonLink, Column, TopBar } from "@/components/ui";
import { APP_NAME } from "@/config/app";
import { isSignedIn } from "@/lib/server/account";
import { loadShared } from "@/lib/server/shared-note";
import { shareDescription, sharedBody, sharedOutputPath, sharePath } from "@/lib/share/share";
import { displayTitle } from "@/lib/ui/format";
import { notePath } from "@/lib/web/paths";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const found = await loadShared(token).catch(() => null);
  if (found?.kind !== "note") return { title: found ? "Shared note" : "Link not active", robots: { index: false, follow: false } };
  const { note } = found.page;
  const title = displayTitle(note.note.title);
  // A note shared with invited people says nothing of itself to previews and is never listed.
  if (note.access === "people") return { title, robots: { index: false, follow: false, nocache: true } };
  const description = shareDescription(note.note.notes) || `A note${note.author ? ` by @${note.author}` : ""} shared on ${APP_NAME}.`;
  return {
    title,
    description,
    // Off unless the owner lets search engines list it.
    robots: note.indexable ? { index: true, follow: false } : { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "article", siteName: APP_NAME, ...(note.author ? { authors: [`@${note.author}`] } : {}) },
    twitter: { card: "summary_large_image", title, description },
  };
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A note shared with invited people, opened by someone who isn't one (or isn't signed in yet). */
function Restricted({ token, signedIn }: { token: string; signedIn: boolean }) {
  return (
    <Column>
      <TopBar />
      <main className="py-16">
        <h1 className="text-2xl font-medium tracking-tight text-fg">{signedIn ? "You don’t have access to this note" : "Sign in to open this note"}</h1>
        <p className="mt-3 max-w-prose text-muted">
          {signedIn
            ? "It’s shared with specific people. Ask its owner to add your Benchjot username; it then opens here and stays in your Shared with me list."
            : "It’s shared with specific people. Sign in with the account its owner added, and it opens here."}
        </p>
        <div className="mt-8">
          {signedIn ? <ButtonLink href="/">Go to your notes</ButtonLink> : <ButtonLink href={`/login?next=${encodeURIComponent(sharePath(token))}`}>Sign in</ButtonLink>}
        </div>
      </main>
    </Column>
  );
}

/**
 * A shared note, read-only: the note as its owner sees it (its text, each cell's notes, code unless
 * shared with results only, what each run printed and made), as it is saved now. Shared with anyone
 * who has the link, it opens without signing in; shared with people, it opens for them only. Copy to
 * my Benchjot (when allowed), Share link and Download are at the top.
 */
export default async function SharedNotePage({ params }: Props) {
  const { token } = await params;
  const found = await loadShared(token);
  if (!found) notFound();
  if (found.kind === "restricted") return <Restricted token={token} signedIn={found.signedIn} />;
  const { note, urls } = found.page;
  const signedIn = note.access === "people" ? true : await isSignedIn();
  const title = displayTitle(note.note.title);
  const body = sharedBody(note.note.notes, note.links);
  const outputs = note.cells.map((c, i) => ({
    urls: urls[i] ?? {},
    hrefs: c.last_run?.outputs ? c.last_run.outputs.items.map((_item, n) => sharedOutputPath(token, i, n)) : null,
  }));
  const link = "text-fg underline decoration-line underline-offset-4 hover:decoration-fg";

  return (
    <Column className="pb-24">
      <TopBar
        right={
          <SharedActions
            token={token}
            title={title}
            canCopy={note.allow_copy && !note.mine}
            signedIn={signedIn}
            exportNote={{
              title,
              body,
              outcome: note.note.outcome,
              cells: note.cells.map((c, i) => ({ filename: c.filename, language: c.language, code: c.content, noteBefore: c.note_before, noteAfter: c.note_after, run: c.last_run, urls: urls[i] ?? {} })),
            }}
          />
        }
      />
      <main>
        <p className="mt-2 text-xs text-muted">
          {note.mine ? (
            <>
              Your note, as the people you shared it with see it ·{" "}
              <Link href={notePath(note.note.id)} className={link}>
                Open to edit
              </Link>
            </>
          ) : (
            <>
              {note.access === "people" ? "Shared with you" : "Shared note"}
              {note.author && <> · by @{note.author}</>}
            </>
          )}{" "}
          · updated {day.format(new Date(note.note.updated_at))}
        </p>
        <NotePreview note={{ title, notes: body, outcome: note.note.outcome }} cells={note.cells} outputs={outputs} showCode={note.show_code} />
        {signedIn ? (
          <footer className="mt-16 border-t border-line pt-6 text-sm text-muted">
            <p>
              Shared with{" "}
              <Link href="/" className={link}>
                {APP_NAME}
              </Link>
              .
            </p>
          </footer>
        ) : (
          <aside aria-label={`About ${APP_NAME}`} className="card mt-16 flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-[19px] leading-snug text-fg">Your experiments, kept like this.</p>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">The question, the code, the results and what worked, in one note. Free, no card.</p>
            </div>
            <ButtonLink href="/login?mode=signup" size="sm" className="shrink-0">
              Start free
            </ButtonLink>
          </aside>
        )}
      </main>
      {!note.mine && <SharedViewCount token={token} />}
    </Column>
  );
}
