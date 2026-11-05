"use client";
// The note map: every note as a dot, links as solid lines, parent -> sub-note
// as dashed lines. Drag to pan, pinch or wheel to zoom, tap a note to open it.
// Drawn in screen coordinates so dots, lines and labels stay the same size at any zoom.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNoteIndex, useNoteLinks } from "@/lib/data";
import { displayTitle } from "@/lib/format";
import { buildEdges, layoutGraph } from "@/lib/graph";
import { dragStep, fitView, zoomAt, type View } from "@/lib/pan-zoom";
import { Column, TextLink, TopBar } from "./ui";

const TAP_SLOP = 8; // px a pointer may move and still count as a tap
const HIT_RADIUS = 24; // px: a 48px tap target around each dot
const LABEL_MAX = 24;

const label = (title: string) => {
  const t = displayTitle(title);
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
};

export function NoteMap() {
  const router = useRouter();
  const { data: notes, error: notesError } = useNoteIndex();
  const { data: links, error: linksError } = useNoteLinks();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const graph = useMemo(() => {
    if (!notes || !links) return null;
    const edges = buildEdges(notes, links);
    const placed = layoutGraph(notes, edges);
    return { edges, placed, at: new Map(placed.map((p) => [p.id, p])) };
  }, [notes, links]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the whole map when it (or the screen) first becomes known.
  const fitted = useRef<string>("");
  useEffect(() => {
    if (!graph || !size) return;
    const key = `${graph.placed.length}:${Math.round(size.w)}x${Math.round(size.h)}`;
    if (fitted.current === key) return;
    fitted.current = key;
    setView(fitView(graph.placed, size.w, size.h));
  }, [graph, size]);

  // Wheel zoom (desktop); a non-passive listener so the page doesn't scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- pointers: one drags, two pinch; a still single touch is a tap.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, multi: false, sx: 0, sy: 0 });

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { moved: false, multi: false, sx: p.x, sy: p.y };
    else gesture.current.multi = true;
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    const g = gesture.current;
    if (Math.hypot(p.x - g.sx, p.y - g.sy) > TAP_SLOP) g.moved = true;
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId).map(([, q]) => q);
    const v = dragStep(viewRef.current, prev, p, others[0] ?? null);
    pointers.current.set(e.pointerId, p);
    setView(v);
  }

  function onPointerUp(e: React.PointerEvent) {
    const had = pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!had || g.moved || g.multi || pointers.current.size > 0 || !graph) return;
    const p = local(e);
    const v = viewRef.current;
    let best: { id: string; d: number } | null = null;
    for (const n of graph.placed) {
      const d = Math.hypot(n.x * v.k + v.x - p.x, n.y * v.k + v.y - p.y);
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { id: n.id, d };
    }
    if (best) router.push(`/n/${best.id}`);
  }

  const sx = (x: number) => x * view.k + view.x;
  const sy = (y: number) => y * view.k + view.y;

  return (
    <div className="flex h-dvh flex-col">
      <Column>
        <TopBar
          left={<TextLink href="/">All notes</TextLink>}
          right={
            <span aria-hidden className="flex items-center gap-4 text-xs text-muted">
              <Legend dashed={false}>Link</Legend>
              <Legend dashed>Sub-note</Legend>
            </span>
          }
        />
      </Column>
      <div ref={box} className="relative min-h-0 flex-1 touch-none select-none overflow-hidden border-t border-line">
        {(notesError || linksError) && <p role="alert" className="p-5 text-sm">Couldn’t load the map. Try again.</p>}
        {notes && notes.length === 0 && <p className="p-5 text-sm text-muted">No notes yet.</p>}
        {graph && size && (
          <svg
            width={size.w}
            height={size.h}
            role="img"
            aria-label={`Map of ${graph.placed.length} notes`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={(e) => {
              pointers.current.delete(e.pointerId);
              gesture.current.moved = true;
            }}
            className="block"
          >
            <g strokeWidth={1}>
              {graph.edges.map((e) => {
                const a = graph.at.get(e.source)!;
                const b = graph.at.get(e.target)!;
                return (
                  <line
                    key={`${e.kind}:${e.source}:${e.target}`}
                    x1={sx(a.x)}
                    y1={sy(a.y)}
                    x2={sx(b.x)}
                    y2={sy(b.y)}
                    stroke={e.kind === "link" ? "var(--muted)" : "var(--faint)"}
                    strokeDasharray={e.kind === "parent" ? "4 4" : undefined}
                  />
                );
              })}
            </g>
            {graph.placed.map((n) => (
              <g
                key={n.id}
                role="link"
                tabIndex={0}
                aria-label={displayTitle(n.title)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/n/${n.id}`)}
                transform={`translate(${sx(n.x)} ${sy(n.y)})`}
                className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-fg"
              >
                <circle r={5} fill="var(--fg)" stroke="transparent" strokeWidth={2} />
                <text
                  x={9}
                  y={4}
                  fontSize={12}
                  fill={n.title.trim() ? "var(--fg)" : "var(--muted)"}
                  stroke="var(--bg)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  {label(n.title)}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function Legend({ dashed, children }: { dashed: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width={18} height={2} className="shrink-0">
        <line x1={0} y1={1} x2={18} y2={1} stroke={dashed ? "var(--faint)" : "var(--muted)"} strokeWidth={1} strokeDasharray={dashed ? "4 4" : undefined} />
      </svg>
      {children}
    </span>
  );
}
