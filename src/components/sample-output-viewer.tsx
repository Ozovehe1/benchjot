"use client";
// The landing's example note: one output on its own page, read from the bundled files
// (public/sample-outputs), never from Storage. Back goes to the landing.
import { sampleOutputPath } from "@/lib/paths";
import { SAMPLE_OUTPUT_URLS, SAMPLE_SNIPPETS } from "@/lib/sample-note";
import { ExampleBadge } from "./note-parts";
import { OutputView } from "./output-view";

async function read(name: string): Promise<Uint8Array> {
  const url = SAMPLE_OUTPUT_URLS[name];
  if (!url) throw new Error("No such file");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the output (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function SampleOutputViewer({ index }: { index: number }) {
  const s = SAMPLE_SNIPPETS[0]!;
  return (
    <OutputView
      items={s.last_run?.outputs?.items ?? null}
      index={index}
      urls={SAMPLE_OUTPUT_URLS}
      read={read}
      base={s.filename}
      back="/"
      backLabel="Back to example"
      step={sampleOutputPath}
      missing="This example output doesn’t exist."
      badge={<ExampleBadge />}
    />
  );
}
