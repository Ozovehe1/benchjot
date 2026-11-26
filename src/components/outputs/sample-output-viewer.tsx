"use client";
// The landing's example note: one output of one cell on its own page, read from the bundled files
// (public/sample-outputs/<cell>/), never from Storage. Back goes to the landing.
import { sampleOutputPath } from "@/lib/web/paths";
import { SAMPLE_OUTPUT_URLS, SAMPLE_CELLS } from "@/lib/sample-note";
import { SampleNoteTag } from "../notes/note-parts";
import { OutputView } from "./output-view";

export function SampleOutputViewer({ cell, index }: { cell: number; index: number }) {
  const s = SAMPLE_CELLS[cell];
  const urls = SAMPLE_OUTPUT_URLS[cell] ?? {};
  async function read(name: string): Promise<Uint8Array> {
    const url = urls[name];
    if (!url) throw Object.assign(new Error("no such sample file"), { status: 404 });
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`sample file ${res.status}`), { status: res.status });
    return new Uint8Array(await res.arrayBuffer());
  }
  return (
    <OutputView
      items={s?.last_run?.outputs?.items ?? null}
      index={index}
      urls={urls}
      read={read}
      base={s?.filename ?? "sample"}
      back="/"
      step={(i) => sampleOutputPath(cell, i)}
      missing="This example output doesn’t exist."
      badge={<SampleNoteTag />}
    />
  );
}
