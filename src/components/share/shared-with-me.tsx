"use client";
// Home's invitations and "Shared with me": notes other people shared with you. An invitation (someone
// added you by username) waits at the top with Accept and Decline; you can open it first to look.
// Accepted ones, and notes you opened through someone's link, are listed under Shared with me; each
// opens read-only at its shared page. Nothing shows when there are none (or offline).
import Link from "next/link";
import { useState } from "react";
import { respondToShare, useSharedWithMe, type SharedWithMe as Shared } from "@/lib/data/shares";
import { OUTCOME_LABEL, isOutcome } from "@/lib/notes/outcome";
import { sharePath } from "@/lib/share/share";
import { displayTitle } from "@/lib/ui/format";
import { userMessage } from "@/lib/ui/user-message";
import { Button, IconChevron, IconLink, Notice, TextButton } from "../ui";

function Invitation({ n }: { n: Shared }) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function answer(accept: boolean) {
    setBusy(accept ? "accept" : "decline");
    setError(null);
    try {
      await respondToShare(n.note_id, accept);
    } catch (e) {
      setError(userMessage(e, "share"));
      setBusy(null);
    }
  }
  return (
    <li className="card px-4 py-3.5">
      <p className="text-[14px] leading-snug text-muted">
        <span className="text-fg">{n.author ? `@${n.author}` : "Someone"}</span> shared{" "}
        <Link href={sharePath(n.token)} className="text-fg underline decoration-line underline-offset-4 hover:decoration-fg">{displayTitle(n.title)}</Link> with you
      </p>
      <div className="mt-2.5 flex items-center gap-3">
        <Button size="sm" onClick={() => void answer(true)} loading={busy === "accept"} disabled={busy !== null} className="h-9 px-4">Accept</Button>
        <TextButton onClick={() => void answer(false)} disabled={busy !== null}>{busy === "decline" ? "Declining…" : "Decline"}</TextButton>
      </div>
      {error && <Notice className="mt-2">{error}</Notice>}
    </li>
  );
}

export function SharedWithMe() {
  const { data } = useSharedWithMe();
  if (!data?.length) return null;
  const invites = data.filter((n) => n.pending);
  const kept = data.filter((n) => !n.pending);
  return (
    <>
      {invites.length > 0 && (
        <section aria-label="Invitations" className="mt-10">
          <h2 className="eyebrow">Invitations</h2>
          <ul className="mt-3 space-y-2">
            {invites.map((n) => <Invitation key={n.note_id} n={n} />)}
          </ul>
        </section>
      )}
      {kept.length > 0 && (
        <section aria-label="Shared with me" className="mt-10">
          <h2 className="eyebrow">Shared with me</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {kept.map((n) => (
              <li key={n.note_id}>
                <Link href={sharePath(n.token)} className="group flex min-h-14 items-center gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40">
                  <IconLink className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-fg">{displayTitle(n.title)}</span>
                    <span className="mt-0.5 block truncate text-xs text-faint">
                      {n.author ? `@${n.author}` : "Someone"}
                      {isOutcome(n.outcome) && ` · ${OUTCOME_LABEL[n.outcome]}`}
                    </span>
                  </span>
                  <IconChevron className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
