"use client";
// One figure, table or chart on its own page: pinch / wheel zoom for images, the
// chart library's own zoom, pan, hover and legend toggles for charts, every row
// kept for tables; and a format picker to download it.
import { useEffect, useRef, useState } from "react";
import { useSnippets } from "@/lib/data";
import { convertImage, pngToPdf, type DrawnChart } from "@/lib/charts";
import { notePath } from "@/lib/paths";
import { dragStep, zoomAt, type View } from "@/lib/pan-zoom";
import { displayFile, downloadFormats, downloadName, MIME, outputLabel, previewCsv, type DownloadFormat, type OutputItem, type SavedOutputs } from "@/lib/run/outputs";
import { fetchOutput, useOutputUrls } from "@/lib/run/output-store";
import { saveBlob } from "@/lib/save-file";
import { ChartView } from "./chart-view";
import { TablePreview } from "./run-outputs";
import { Button, Column, TextLink, TopBar } from "./ui";

const MIN = 1;
const MAX = 8;
const HOME: View = { k: 1, x: 0, y: 0 };

/** An image that pinches, drags and wheel-zooms (1x–8x); double-tap toggles 2.5x / fit. */
function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(HOME);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView(clampPan(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top, MIN, MAX), r));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function down(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const now = Date.now();
    if (pointers.current.size === 1 && now - lastTap.current < 300) {
      const p = local(e);
      setView(viewRef.current.k > 1.01 ? HOME : clampPan(zoomAt(HOME, 2.5, p.x, p.y, MIN, MAX), box.current!.getBoundingClientRect()));
      lastTap.current = 0;
    } else lastTap.current = now;
  }
  function move(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1] ?? null;
    pointers.current.set(e.pointerId, p);
    setView(clampPan(dragStep(viewRef.current, prev, p, other, MIN, MAX), box.current!.getBoundingClientRect()));
  }
  const up = (e: React.PointerEvent) => void pointers.current.delete(e.pointerId);

  return (
    <div
      ref={box}
      className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-label="Pinch or scroll to zoom, drag to move, double-tap to reset"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="h-full w-full object-contain"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}
      />
    </div>
  );
}

/** Keeps a zoomed image covering its box (no panning it off screen). */
function clampPan(v: View, r: DOMRect): View {
  const minX = r.width - r.width * v.k;
  const minY = r.height - r.height * v.k;
  return { k: v.k, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
}

async function download(item: OutputItem, outputs: SavedOutputs, f: DownloadFormat, chart: DrawnChart | null, name: string) {
  if (f.how === "file") {
    const data = await fetchOutput(outputs, f.file);
    return saveBlob(name, new Blob([data as BlobPart], { type: MIME[f.format] }));
  }
  if (f.how === "convert") {
    const data = await fetchOutput(outputs, f.from);
    return saveBlob(name, await convertImage(new Blob([data as BlobPart], { type: MIME.png }), f.format, "#ffffff"));
  }
  if (item.kind === "table") return saveBlob(name, new Blob([previewCsv(item)], { type: MIME.csv }));
  if (!chart) throw new Error("The chart is still drawing");
  if (f.format === "pdf") return saveBlob(name, await pngToPdf(await chart.image("png", 2), 2));
  return saveBlob(name, await chart.image(f.format as "png" | "jpg" | "webp" | "svg"));
}

export function OutputViewer({ noteId, snippetId, index }: { noteId: string; snippetId: string; index: number }) {
  const { data: snippets, isLoading } = useSnippets(noteId);
  const snippet = snippets?.find((s) => s.id === snippetId);
  const outputs = snippet?.last_run?.outputs ?? null;
  const item = outputs?.items[index];
  const { data: urls } = useOutputUrls(outputs);
  const formats = item ? downloadFormats(item) : [];
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chart = useRef<DrawnChart | null>(null);
  const back = <TextLink href={notePath(noteId)}>Back to note</TextLink>;
  const count = outputs?.items.length ?? 0;
  const step = (d: number) => `${notePath(noteId)}/out/${snippetId}/${index + d}`;

  if (!item || !outputs) {
    return (
      <Column>
        <TopBar left={back} />
        <p className="py-8 text-sm text-muted">{isLoading ? "Loading…" : "This output isn’t here any more. Run the code again to make it."}</p>
      </Column>
    );
  }

  const chosen = formats[Math.min(pick, formats.length - 1)];
  const base = snippet?.filename || "output";
  async function save() {
    if (!chosen || !item || !outputs) return;
    setBusy(true);
    setError(null);
    try {
      await download(item, outputs, chosen, chart.current, downloadName(base, index, chosen.format));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label = `${outputLabel(item)}${item.kind !== "table" && item.title ? ` · ${item.title}` : ""}`;
  return (
    <div className="flex h-dvh flex-col">
      <Column>
        <TopBar
          left={back}
          right={
            count > 1 && (
              <span className="flex items-center gap-4 text-sm">
                {index > 0 && (
                  <TextLink href={step(-1)} aria-label="Previous output">
                    Prev
                  </TextLink>
                )}
                <span className="font-mono text-xs text-faint">
                  {index + 1} / {count}
                </span>
                {index < count - 1 && (
                  <TextLink href={step(1)} aria-label="Next output">
                    Next
                  </TextLink>
                )}
              </span>
            )
          }
        />
        <h1 className="truncate pb-2 font-mono text-xs text-faint">{label}</h1>
      </Column>

      <main className="flex min-h-0 flex-1 flex-col">
        {item.kind === "image" && (urls?.[displayFile(item) ?? ""] ? <ZoomableImage src={urls[displayFile(item)!]!} alt={item.title || label} /> : <div className="flex-1" />)}
        {item.kind === "chart" && (
          <Column className="flex min-h-0 flex-1 flex-col">
            <ChartView item={item} specUrl={item.files.json ? urls?.[item.files.json] : undefined} interactive className="min-h-0 flex-1" onReady={(c) => (chart.current = c)} />
          </Column>
        )}
        {item.kind === "table" && (
          <Column className="min-h-0 flex-1 overflow-auto">
            <TablePreview table={item} rows={item.rows.length} />
          </Column>
        )}
      </main>

      <Column className="border-t border-line pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="flex items-center justify-between gap-4">
          <label className="flex min-h-12 items-center gap-2 text-sm text-muted">
            Format
            <select
              value={pick}
              onChange={(e) => setPick(Number(e.target.value))}
              aria-label="Download format"
              className="min-h-12 cursor-pointer appearance-none bg-transparent px-1 text-fg outline-none"
            >
              {formats.map((f, i) => (
                <option key={f.format + f.how} value={i}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={save} disabled={busy || !chosen}>
            {busy ? "Preparing…" : "Download"}
          </Button>
        </div>
        {error && <p className="pb-2 font-mono text-xs text-muted">{error}</p>}
      </Column>
    </div>
  );
}
