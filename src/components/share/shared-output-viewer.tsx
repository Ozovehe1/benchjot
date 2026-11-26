"use client";
// One output of a shared note's cell on its own page (/s/<token>/out/<cell>/<n>): the files signed
// for this link on the server, shown and downloaded as in the app. Back goes to the shared note.
import type { OutputItem } from "@/lib/run/outputs";
import { sharePath, sharedOutputPath } from "@/lib/share/share";
import { OutputView } from "../outputs/output-view";

export function SharedOutputViewer({ token, cell, index, items, urls, base }: { token: string; cell: number; index: number; items: readonly OutputItem[] | null; urls: Readonly<Record<string, string>>; base: string }) {
  async function read(name: string): Promise<Uint8Array> {
    const url = urls[name];
    if (!url) throw Object.assign(new Error("no such shared file"), { status: 404 });
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`shared file ${res.status}`), { status: res.status });
    return new Uint8Array(await res.arrayBuffer());
  }
  return (
    <OutputView
      items={items}
      index={index}
      urls={urls}
      read={read}
      base={base}
      back={sharePath(token)}
      step={(i) => sharedOutputPath(token, cell, i)}
      missing="This output isn’t in the shared note any more."
    />
  );
}
