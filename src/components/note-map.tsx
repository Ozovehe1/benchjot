"use client";
// The Research Map. Two lenses over one model (lib/graph.ts, shared with Android):
// Around a note (its neighbourhood, depth 1–3, the focus at the centre) and Everything.
// Marks: hollow circle = unmarked, filled circle = successful, diamond = failed; size grows
// with connections. Edges are directed: links (solid), sub-notes (dashed), attempts (bold, always
// arrowed). Drag to pan, pinch or wheel to zoom, tap a note to open it. Keyboard: Tab to a note,
// Enter opens; on the map, arrows pan, + and - zoom, 0 fits. "Map as list" shows the same map as rows.
// Drawn in screen coordinates so marks, lines and labels stay the same size at any zoom.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNoteIndex, useNoteLinks } from "@/lib/data";
import { cn, displayTitle } from "@/lib/format";
import {
  aroundGraph,
  aroundList,
  arrowHead,
  buildGraph,
  edgeEnds,
  HIT_RADIUS,
  layoutGraph,
  showArrow,
  type EdgeKind,
  type GraphNode,
  type Lens,
  type Mark,
} from "@/lib/graph";
import { dragStep, fitView, zoomAt, type View } from "@/lib/pan-zoom";
import { ERROR_TEXT, userMessage } from "@/lib/user-message";
import { Column, Segmented, TextButton, TextLink, TopBar } from "./ui";

const TAP_SLOP = 8; // px a pointer may move and still count as a tap
const LABEL_MAX = 24;
const PAN_STEP = 48; // px per arrow key
const ZOOM_STEP = 1.25;

const label = (title: string) => {
  const t = displayTitle(title);
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
};

const EDGE_STYLE: Record<EdgeKind, { stroke: string; width: number; dash?: string }> = {
  link: { stroke: "var(--muted)", width: 1 },
  parent: { stroke: "var(--faint)", width: 1, dash: "4 4" },
  derived: { stroke: "var(--fg)", width: 1.5 },
};

/** A diamond's half-diagonal for radius r: about the same area as the circle. */
const diamond = (r: number) => r * 1.25;
const rim = (mark: Mark, r: number) => (mark === "failed" ? diamond(r) : r);

interface Props {
  focus: string | null;
  depth: number;
  lens: Lens;
  asList: boolean;
}

function href(focus: string | null, o: { lens: Lens; depth: number; asList: boolean }) {
  const q = new URLSearchParams();
  if (focus) q.set("focus", focus);
  if (focus && o.lens === "around") q.set("depth", String(o.depth));
  if (focus && o.lens === "everything") q.set("lens", "all");
  if (o.asList) q.set("view", "list");
  const s = q.toString();
  return s ? `/map?${s}` : "/map";
}

export function NoteMap({ focus, depth, lens, asList }: Props) {
  const router = useRouter();
  const { data: notes, error: notesError } = useNoteIndex();
  const { data: links, error: linksError } = useNoteLinks();
  const loadError = notesError ?? linksError;

  const whole = useMemo(() => (notes && links ? buildGraph(notes, links) : null), [notes, links]);
  const shown = useMemo(() => {
    if (!whole) return null;
    const g = lens === "around" && focus ? aroundGraph(whole, focus, depth) : { ...whole, hops: null };
    const placed = layoutGraph(g.nodes, g.edges, lens === "around" ? (focus ?? undefined) : undefined);
    return { ...g, placed, at: new Map(placed.map((p) => [p.id, p])) };
  }, [whole, lens, focus, depth]);

  const focusNode = whole?.nodes.find((n) => n.id === focus) ?? null;
  const go = (o: Partial<{ lens: Lens; depth: number; asList: boolean }>) => router.replace(href(focus, { lens, depth, asList, ...o }));

  return (
    <div className="flex h-dvh flex-col">
      <Column>
        <TopBar
          left={focusNode ? <TextLink href={`/n/${focusNode.id}`}>{displayTitle(focusNode.title)}</TextLink> : <TextLink href="/">All notes</TextLink>}
          right={
            <TextButton onClick={() => go({ asList: !asList })} aria-pressed={asList}>
              {asList ? "Map as picture" : "Map as list"}
            </TextButton>
          }
        />
        <div className="-mt-2 flex flex-wrap items-center gap-x-6 text-xs text-muted">
          {focus && (
            <Segmented<Lens>
              label="View"
              options={[
                { value: "around", label: "Around" },
                { value: "everything", label: "Everything" },
              ]}
              value={lens}
              onChange={(v) => go({ lens: v })}
            />
          )}
          {lens === "around" && (
            <span className="flex items-center gap-2">
              <span aria-hidden>Depth</span>
              <Segmented<number>
                label="Depth"
                options={[1, 2, 3].map((d) => ({ value: d, label: String(d), name: `Depth ${d}` }))}
                value={depth}
                onChange={(v) => go({ depth: v })}
              />
            </span>
          )}
        </div>
      </Column>

      {loadError && (
        <Column>
          <p role="alert" className="py-5 text-sm">
            {userMessage(loadError, "load_map")}
          </p>
        </Column>
      )}
      {notes && notes.length === 0 && (
        <Column>
          <p className="py-5 text-sm text-muted">No notes yet.</p>
        </Column>
      )}
      {whole && lens === "around" && focus && !focusNode && (
        <Column>
          <p role="alert" className="py-5 text-sm">
            {ERROR_TEXT.not_found}
          </p>
        </Column>
      )}

      {shown && shown.nodes.length > 0 && whole && (
        <>
          {asList ? (
            <MapList nodes={shown.nodes} lens={lens} focus={focus} groups={lens === "around" && focus ? aroundList(whole, focus, depth) : null} />
          ) : (
            <MapCanvas key={`${lens}:${focus}:${depth}`} shown={shown} lens={lens} focus={focus} onOpen={(id) => router.push(`/n/${id}`)} />
          )}
        </>
      )}
    </div>
  );
}

interface Shown {
  nodes: GraphNode[];
  edges: { source: string; target: string; kind: EdgeKind; mutual: boolean }[];
  placed: { id: string; x: number; y: number }[];
  at: Map<string, { id: string; x: number; y: number }>;
}

function MapCanvas({ shown, lens, focus, onOpen }: { shown: Shown; lens: Lens; focus: string | null; onOpen: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const byId = useMemo(() => new Map(shown.nodes.map((n) => [n.id, n])), [shown.nodes]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (size) setView(fitView(shown.placed, size.w, size.h));
  }, [shown.placed, size]);

  // Fit the whole map when it (or the screen) first becomes known.
  const fitted = useRef<string>("");
  useEffect(() => {
    if (!size) return;
    const key = `${shown.placed.length}:${Math.round(size.w)}x${Math.round(size.h)}`;
    if (fitted.current === key) return;
    fitted.current = key;
    fit();
  }, [shown.placed.length, size, fit]);

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

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.target !== e.currentTarget || !size) return; // a focused note handles its own keys
    const v = viewRef.current;
    const pan: Record<string, [number, number]> = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] };
    if (pan[e.key]) setView({ ...v, x: v.x + pan[e.key]![0], y: v.y + pan[e.key]![1] });
    else if (e.key === "+" || e.key === "=") setView(zoomAt(v, ZOOM_STEP, size.w / 2, size.h / 2));
    else if (e.key === "-" || e.key === "_") setView(zoomAt(v, 1 / ZOOM_STEP, size.w / 2, size.h / 2));
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
  }

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
    if (!had || g.moved || g.multi || pointers.current.size > 0) return;
    const p = local(e);
    const v = viewRef.current;
    let best: { id: string; d: number } | null = null;
    for (const n of shown.placed) {
      const d = Math.hypot(n.x * v.k + v.x - p.x, n.y * v.k + v.y - p.y);
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { id: n.id, d };
    }
    if (best) onOpen(best.id);
  }

  const sp = (id: string) => {
    const n = shown.at.get(id)!;
    return { x: n.x * view.k + view.x, y: n.y * view.k + view.y };
  };

  return (
    <>
      <Column>
        <div className="flex items-center justify-between gap-4">
          <Legend />
          <TextButton onClick={fit} className="shrink-0 text-xs">
            Fit
          </TextButton>
        </div>
      </Column>
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label={`Map of ${shown.nodes.length} ${shown.nodes.length === 1 ? "note" : "notes"}. Arrow keys pan, plus and minus zoom, 0 fits. Tab moves between notes.`}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden border-t border-line outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-muted"
      >
        {size && (
          <svg
            width={size.w}
            height={size.h}
            role="group"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={(e) => {
              pointers.current.delete(e.pointerId);
              gesture.current.moved = true;
            }}
            className="block"
          >
            <g aria-hidden>
              {shown.edges.map((e) => {
                const a = byId.get(e.source)!;
                const b = byId.get(e.target)!;
                const ends = edgeEnds(sp(e.source), sp(e.target), rim(a.mark, a.radius), rim(b.mark, b.radius));
                if (!ends) return null;
                const s = EDGE_STYLE[e.kind];
                const arrow = showArrow(e.kind, lens, view.k);
                const tri = (from: { x: number; y: number }, tip: { x: number; y: number }) => arrowHead(from, tip).map((q) => `${q.x},${q.y}`).join(" ");
                return (
                  <g key={`${e.kind}:${e.source}:${e.target}`}>
                    <line x1={ends.from.x} y1={ends.from.y} x2={ends.to.x} y2={ends.to.y} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} />
                    {arrow && <polygon points={tri(ends.from, ends.to)} fill={s.stroke} />}
                    {arrow && e.mutual && <polygon points={tri(ends.to, ends.from)} fill={s.stroke} />}
                  </g>
                );
              })}
            </g>
            {shown.nodes.map((n) => {
              const p = sp(n.id);
              const isFocus = lens === "around" && n.id === focus;
              return (
                <g
                  key={n.id}
                  role="link"
                  tabIndex={0}
                  aria-label={isFocus ? `${n.label}, this note` : n.label}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(n.id);
                    }
                  }}
                  transform={`translate(${p.x} ${p.y})`}
                  className="cursor-pointer outline-none [&:focus-visible>.ring]:stroke-fg"
                >
                  <circle className="ring" r={rim(n.mark, n.radius) + 5} fill="none" stroke={isFocus ? "var(--muted)" : "transparent"} strokeWidth={1.5} />
                  <NodeMark mark={n.mark} r={n.radius} />
                  <text
                    x={rim(n.mark, n.radius) + 5}
                    y={4}
                    fontSize={12}
                    fontWeight={isFocus ? 600 : undefined}
                    fill={n.title.trim() ? "var(--fg)" : "var(--muted)"}
                    stroke="var(--bg)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {label(n.title)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </>
  );
}

/** Outcome by shape and colour: hollow circle, filled circle, diamond. */
function NodeMark({ mark, r }: { mark: Mark; r: number }) {
  if (mark === "failed") {
    const d = diamond(r);
    return <polygon points={`0,${-d} ${d},0 0,${d} ${-d},0`} fill="var(--fail)" />;
  }
  if (mark === "success") return <circle r={r} fill="var(--fg)" />;
  return <circle r={r - 0.75} fill="var(--bg)" stroke="var(--fg)" strokeWidth={1.5} />;
}

function Legend() {
  const line = (k: EdgeKind) => {
    const s = EDGE_STYLE[k];
    return (
      <svg width={22} height={8} aria-hidden className="shrink-0">
        <line x1={0} y1={4} x2={16} y2={4} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} />
        <polygon points="22,4 15,0.5 15,7.5" fill={s.stroke} />
      </svg>
    );
  };
  const mark = (m: Mark) => (
    <svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden className="shrink-0">
      <NodeMark mark={m} r={4.5} />
    </svg>
  );
  const items: [React.ReactNode, string][] = [
    [mark("success"), "Successful"],
    [mark("failed"), "Failed"],
    [mark("unmarked"), "Unmarked"],
    [line("link"), "Link"],
    [line("parent"), "Sub-note"],
    [line("derived"), "Attempt"],
  ];
  return (
    <ul aria-label="Key" className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs text-muted">
      {items.map(([icon, text]) => (
        <li key={text} className="flex items-center gap-1.5">
          {icon}
          {text}
        </li>
      ))}
    </ul>
  );
}

/** The map as rows: every note (Everything), or the focus's neighbours by how they connect (Around). Each row a 48px link. */
function MapList({ nodes, lens, focus, groups }: { nodes: GraphNode[]; lens: Lens; focus: string | null; groups: ReturnType<typeof aroundList> | null }) {
  const row = (n: GraphNode) => (
    <li key={n.id}>
      <Link href={`/n/${n.id}`} aria-label={n.label} className="flex min-h-12 items-center gap-3">
        <svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden className="shrink-0">
          <NodeMark mark={n.mark} r={4.5} />
        </svg>
        <span className={cn("truncate", !n.title.trim() && "text-muted")}>{displayTitle(n.title)}</span>
        <span aria-hidden className="ml-auto shrink-0 text-xs text-muted">
          {n.degree}
        </span>
      </Link>
    </li>
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
      <Column className="pb-24">
        {lens === "around" && groups ? (
          groups.length === 0 ? (
            <p className="py-5 text-sm text-muted">Nothing connects to this note yet.</p>
          ) : (
            groups.map((g) => (
              <Fragment key={g.group}>
                <h2 className="mt-6 text-xs text-muted">{g.group}</h2>
                <ul className="divide-y divide-line">{g.nodes.map(row)}</ul>
              </Fragment>
            ))
          )
        ) : (
          <ul aria-label="Every note" className="divide-y divide-line">
            {nodes.filter((n) => n.id !== focus || lens === "everything").map(row)}
          </ul>
        )}
      </Column>
    </div>
  );
}
