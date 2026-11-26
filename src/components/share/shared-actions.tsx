"use client";
// The shared page's actions: Copy to my Benchjot (when the owner allows it; signed out, it goes
// through sign-in and comes back), and in the menu, Share (the phone's share sheet, or copy the
// link) and Download (Jupyter, web page or Markdown, built in the browser like Export note).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExportNote } from "@/lib/files/note-export";
import type { LastRun } from "@/lib/notes/schemas";
import { copyText } from "@/lib/ui/copy";
import { userMessage } from "@/lib/ui/user-message";
import { notePath } from "@/lib/web/paths";
import { sharePath } from "@/lib/share/share";
import { ExportNoteDialog, type ExportNoteHandle } from "../notes/export-note";
import { Button, ButtonLink, MoreMenu, Notice } from "../ui";

interface SharedExportCell {
  filename: string;
  language: string;
  code: string;
  noteBefore: string;
  noteAfter: string;
  run: LastRun | null;
  /** Its files' signed addresses, by name. */
  urls: Readonly<Record<string, string>>;
}

export function SharedActions({
  token,
  title,
  canCopy,
  signedIn,
  exportNote,
}: {
  token: string;
  title: string;
  canCopy: boolean;
  signedIn: boolean;
  exportNote: { title: string; body: string; outcome: ExportNote["outcome"]; cells: readonly SharedExportCell[] };
}) {
  const router = useRouter();
  const exportDialog = useRef<ExportNoteHandle>(null);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  async function copyToMine() {
    setCopying(true);
    setNotice(null);
    try {
      const res = await fetch("/api/share/copy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw Object.assign(new Error(data.error ?? `copy answered ${res.status}`), { status: res.status, code: "notice", friendly: data.error });
      router.push(notePath(data.id));
    } catch (e) {
      setNotice({ text: (e as { friendly?: string }).friendly ?? userMessage(e, "copy_note"), tone: "error" });
      setCopying(false);
    }
  }

  async function share() {
    const url = `${window.location.origin}${sharePath(token)}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return; // closed the share sheet
      }
    }
    setNotice({ text: (await copyText(url)) ? "Link copied." : `Copy this link: ${url}`, tone: "info" });
  }

  async function read(): Promise<ExportNote> {
    return {
      title: exportNote.title,
      body: exportNote.body,
      outcome: exportNote.outcome,
      exportedAt: new Date().toISOString(),
      cells: await Promise.all(
        exportNote.cells.map(async (c) => {
          const files = Object.fromEntries(
            await Promise.all(
              Object.entries(c.urls).map(async ([name, url]) => {
                const res = await fetch(url);
                if (!res.ok) throw Object.assign(new Error(`file ${res.status}`), { status: res.status });
                return [name, new Uint8Array(await res.arrayBuffer())] as const;
              }),
            ),
          );
          return { filename: c.filename, language: c.language, code: c.code, noteBefore: c.noteBefore, noteAfter: c.noteAfter, run: c.run, files };
        }),
      ),
    };
  }

  const next = encodeURIComponent(sharePath(token));
  return (
    <>
      {canCopy &&
        (signedIn ? (
          <Button variant="soft" size="sm" onClick={() => void copyToMine()} loading={copying} className="h-10 px-3.5">
            {copying ? "Copying…" : "Copy to my Benchjot"}
          </Button>
        ) : (
          <ButtonLink href={`/login?next=${next}`} variant="soft" size="sm" className="h-10 px-3.5">
            Copy to my Benchjot
          </ButtonLink>
        ))}
      <MoreMenu
        items={[
          { label: "Share link", onSelect: () => void share() },
          { label: "Download", onSelect: () => exportDialog.current?.open() },
        ]}
      />
      <ExportNoteDialog ref={exportDialog} read={read} />
      {notice && (
        <div role="status" className="fixed inset-x-0 bottom-6 z-30 mx-auto w-[min(28rem,calc(100vw-2rem))]">
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>
        </div>
      )}
    </>
  );
}

/** Counts this view once per browser per day (after the page shows; previews and crawlers don't run it). */
export function SharedViewCount({ token }: { token: string }) {
  useEffect(() => {
    const key = `bj-seen-${token}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      // Storage refused (private mode): count it anyway, at most once per page load.
    }
    void fetch("/api/share/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), keepalive: true }).catch(() => undefined);
  }, [token]);
  return null;
}
