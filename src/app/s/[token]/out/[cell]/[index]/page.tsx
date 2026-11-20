import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedOutputViewer } from "@/components/share/shared-output-viewer";
import { loadShared } from "@/lib/server/shared-note";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// A shared note's output on its own page; the note and its signed files come from the same cached read as the note.
export default async function SharedOutputPage({ params }: { params: Promise<{ token: string; cell: string; index: string }> }) {
  const { token, cell, index } = await params;
  const found = await loadShared(token);
  const page = found?.kind === "note" ? found.page : null;
  const n = Number(cell);
  const c = page?.note.cells[n];
  if (!page || !c) notFound();
  return <SharedOutputViewer token={token} cell={n} index={Number(index)} items={c.last_run?.outputs?.items ?? null} urls={page.urls[n] ?? {}} base={c.filename || "output"} />;
}
