"use client";
// The Research Map. Two lenses over one model (lib/notes/graph.ts, shared with Android):
// Around a note (its neighbourhood, depth 1–3, the focus at the centre) and Everything.
// Marks: hollow dot = unmarked, filled dot = successful, red dot = failed; size grows
// with connections. Edges are directed: links (solid), sub-notes (dashed), attempts (bold, always
// arrowed). Drag to pan, pinch or wheel to zoom, tap a note to open it. Keyboard: Tab to a note,
// Enter opens; on the map, arrows pan, + and - zoom, 0 shows all ("Show all"). "Map as list" shows the same map as rows.
// Drawn in screen coordinates so marks, lines and labels stay the same size at any zoom.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNoteIndex, useNoteLinks, useProjects } from "@/lib/data";
import { cn, displayTitle } from "@/lib/ui/format";
import {
  aroundGraph,
  aroundList,
  arrowHead,
  buildGraph,
  edgeEnds,
  HIT_RADIUS,
  isFiltering,
  labelsToShow,
  layoutGraph,
  MAP_MAX_NOTES,
  mapMatches,
  mapSlice,
  NO_FILTER,
  type MapFilter,
  showArrow,
  type EdgeKind,
  type GraphNode,
  type Lens,
  type Mark,
  type PlacedNode,
} from "@/lib/notes/graph";
import { dragStep, fitView, zoomAt, type View } from "@/lib/ui/pan-zoom";
import { ERROR_TEXT, userMessage } from "@/lib/ui/user-message";
import { Button, Column, IconMap, IconNote, IconPlus, IconSearch, IconX, Notice, Segmented, TextButton, TextLink, TopBar, Working } from "../ui";

const TAP_SLOP = 8; // px a pointer may move and still count as a tap
const LABEL_MAX = 34;
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

/**
 * The picture's positions, worked out on a background thread (layout.worker.ts) so a big map never
 * freezes the page; null until they arrive. Where workers aren't available, worked out here.
 */
function useLayout(part: { nodes: readonly { id: string }[]; edges: readonly { source: string; target: string }[] } | null, focus: string | undefined): PlacedNode[] | null {
  const [done, setDone] = useState<{ part: object; placed: PlacedNode[] } | null>(null);
  useEffect(() => {
    if (!part) return;
    let live = true;
    const input = { nodes: part.nodes.map((n) => ({ id: n.id })), edges: part.edges.map((e) => ({ source: e.source, target: e.target })), focus };
    const here = () => void Promise.resolve().then(() => live && setDone({ part, placed: layoutGraph(input.nodes, input.edges, input.focus) }));
    if (typeof Worker === "undefined") {
      here();
      return () => void (live = false);
    }
    const w = new Worker(new URL("../../lib/notes/layout.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<PlacedNode[]>) => live && setDone({ part, placed: e.data });
    w.onerror = () => here();
    w.postMessage(input);
    return () => {
      live = false;
      w.terminate();
    };
  }, [part, focus]);
  return done && done.part === part ? done.placed : null;
}

export function NoteMap({ focus, depth, lens, asList }: Props) {
  const router = useRouter();
  const { data: notes, error: notesError, mutate: reloadNotes } = useNoteIndex();
  const { data: links, error: linksError, mutate: reloadLinks } = useNoteLinks();
  const retryMap = () => Promise.all([reloadNotes(), reloadLinks()]);
  const loadError = notesError ?? linksError;

  const whole = useMemo(() => (notes && links ? buildGraph(notes, links) : null), [notes, links]);
  // What the lens shows, before layout: the picture's notes and edges, the notes left out of it.
  const part = useMemo(() => {
    if (!whole) return null;
    const all = lens === "around" && focus ? aroundGraph(whole, focus, depth) : { ...whole, hops: null };
    // Notes with no connection aren't scattered over the picture (where they'd look placed on
    // purpose and crowd the ones that connect): they're listed under it as "Not connected yet".
    const loose = lens === "around" ? [] : all.nodes.filter((n) => n.degree === 0);
    const connected = loose.length ? all.nodes.filter((n) => n.degree > 0) : all.nodes;
    // A big map draws the most recent connected groups (the focus's first), up to MAP_MAX_NOTES.
    const first = lens === "around" && focus ? [...connected.filter((n) => n.id === focus), ...connected.filter((n) => n.id !== focus)] : connected;
    const { graph, hidden } = mapSlice({ nodes: first, edges: all.edges }, MAP_MAX_NOTES);
    return { ...all, nodes: graph.nodes, edges: graph.edges, loose, hidden, all: all.nodes };
  }, [whole, lens, focus, depth]);
  const placed = useLayout(part, lens === "around" ? (focus ?? undefined) : undefined);
  const shown = part && placed ? { ...part, placed, at: new Map(placed.map((p) => [p.id, p])) } : null;

  const focusNode = whole?.nodes.find((n) => n.id === focus) ?? null;
  const go = (o: Partial<{ lens: Lens; depth: number; asList: boolean }>) => router.replace(href(focus, { lens, depth, asList, ...o }));

  // Find and filters (overview first, then filter, then details on demand): what doesn't match
  // fades, so the picture keeps its shape. One note at a time is selected; its card has the details.
  const { data: projects } = useProjects();
  const projectName = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);
  const [filter, setFilter] = useState<MapFilter>(NO_FILTER);
  const [selected, setSelected] = useState<string | null>(null);
  const [centerOn, setCenterOn] = useState<{ id: string; n: number } | null>(null);
  const filtering = isFiltering(filter);
  const matches = useMemo(() => (part && filtering ? new Set(part.nodes.filter((n) => mapMatches(n, filter)).map((n) => n.id)) : null), [part, filter, filtering]);
  // Esc: the selection first, then the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) setSelected(null);
      else if (filter.find) setFilter((f) => ({ ...f, find: "" }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, filter.find]);
  const pick = (id: string) => {
    if (part?.nodes.some((n) => n.id === id) && !asList) {
      setSelected(id);
      setCenterOn((c) => ({ id, n: (c?.n ?? 0) + 1 }));
    } else router.replace(href(id, { lens: "around", depth: 1, asList }));
  };

  return (
    <div className="flex h-dvh flex-col">
      <Column>
        <TopBar
          left={focusNode ? <TextLink href={`/n/${focusNode.id}`}>{displayTitle(focusNode.title)}</TextLink> : <TextLink href="/">All notes</TextLink>}
          right={
            <TextButton onClick={() => go({ asList: !asList })} aria-pressed={asList}>
              {asList ? <IconMap /> : <IconNote />}
              {asList ? "Map as picture" : "Map as list"}
            </TextButton>
          }
        />
        <h1 className="mt-4 font-display text-[30px] leading-tight tracking-tight sm:text-[34px]">
          {focusNode && lens === "around" ? (
            <>
              Around {displayTitle(focusNode.title)}
            </>
          ) : (
            <>Map</>
          )}
        </h1>
        {part && (
          <p className="mt-1.5 mb-4 max-w-[62ch] text-sm text-muted">
            {(part.nodes.length + part.hidden + part.loose.length).toLocaleString("en")} {part.nodes.length + part.hidden + part.loose.length === 1 ? "note" : "notes"}. Lines are links, sub-notes and
            attempts. Tap a note for its details, again to open it.
            {part.hidden > 0 && !asList && ` The picture shows the ${part.nodes.length} most recently edited connected notes; Map as list has all of them.`}
          </p>
        )}
        {whole && whole.nodes.length > 0 && (
          <MapToolbar
            filter={filter}
            onFilter={setFilter}
            notes={whole.nodes}
            projects={projects ?? []}
            matched={matches?.size ?? null}
            onPick={pick}
            inPicture={(id) => !!part?.nodes.some((n) => n.id === id)}
          />
        )}
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted empty:hidden">
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
          <Notice className="my-5" actions={[{ label: "Try again", onClick: () => void retryMap() }]}>
            {userMessage(loadError, "load_map")}
          </Notice>
        </Column>
      )}
      {notes && notes.length === 0 && (
        <Column>
          <p className="py-5 text-sm text-muted">No notes yet.</p>
        </Column>
      )}
      {whole && lens === "around" && focus && !focusNode && (
        <Column>
          <Notice className="my-5">{ERROR_TEXT.not_found}</Notice>
        </Column>
      )}

      {part && !asList && part.nodes.length === 0 && part.loose.length > 0 && (
        <Column>
          <Notice tone="info" className="mb-4">
            Nothing is connected yet. Write [[ and a note’s title in another note to link them, make a sub-note, or start a new attempt from a note’s menu; the
            connections appear here.
          </Notice>
        </Column>
      )}
      {part && (part.nodes.length > 0 || (asList && part.loose.length > 0)) && whole && (
        <>
          {asList ? (
            <MapList nodes={[...part.all.filter((n) => n.degree > 0 || lens === "around"), ...part.loose].filter((n) => !filtering || mapMatches(n, filter))} lens={lens} focus={focus} groups={lens === "around" && focus ? aroundList(whole, focus, depth) : null} />
          ) : (
            shown ? (
              <MapCanvas
                key={`${lens}:${focus}:${depth}`}
                shown={shown}
                lens={lens}
                focus={focus}
                matches={matches}
                selected={selected}
                centerOn={centerOn}
                onSelect={setSelected}
                onOpen={(id) => router.push(`/n/${id}`)}
                onAround={(id) => {
                  setSelected(null);
                  router.replace(href(id, { lens: "around", depth: 1, asList: false }));
                }}
                projectName={(id) => (id ? projectName.get(id) : undefined)}
              />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center border-t border-line">
                <Working label={`Laying out ${part.nodes.length} notes…`} />
              </div>
            )
          )}
        </>
      )}
      {part && !asList && part.loose.length > 0 && <LooseNotes nodes={part.loose} />}
    </div>
  );
}

interface Shown {
  nodes: GraphNode[];
  loose: GraphNode[];
  edges: { source: string; target: string; kind: EdgeKind; mutual: boolean }[];
  placed: { id: string; x: number; y: number }[];
  at: Map<string, { id: string; x: number; y: number }>;
}

interface CanvasProps {
  shown: Shown;
  lens: Lens;
  focus: string | null;
  /** Notes the find and filters pick out (the rest fade); null when nothing is filtered. */
  matches: Set<string> | null;
  selected: string | null;
  /** Centre the view on this note (a new `n` each time it's asked). */
  centerOn: { id: string; n: number } | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  onAround: (id: string) => void;
  projectName: (id: string | null) => string | undefined;
}

/** A label's width on screen, close enough to keep labels apart (12.5px Inter). */
const labelWidth = (text: string) => text.length * 6.9 + 6;

function MapCanvas({ shown, lens, focus, matches, selected, centerOn, onSelect, onOpen, onAround, projectName }: CanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const byId = useMemo(() => new Map(shown.nodes.map((n) => [n.id, n])), [shown.nodes]);
  // The note under the pointer (or keyboard focus) and its neighbours stay bright; the rest dims.
  const [hot, setHot] = useState<string | null>(null);
  const near = useMemo(() => {
    if (!hot) return null;
    const s = new Set([hot]);
    for (const e of shown.edges) if (e.source === hot || e.target === hot) s.add(e.source).add(e.target);
    return s;
  }, [hot, shown.edges]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    // Room on the right for the labels and at the bottom for the key and zoom buttons.
    if (size) setView(fitView(shown.placed, size.w, size.h, 40, { right: Math.min(230, size.w * 0.45), bottom: size.w < 640 ? 80 : 48 }));
  }, [shown.placed, size]);

  // Centre on a note found with Find.
  useEffect(() => {
    if (!centerOn || !size) return;
    const n = shown.at.get(centerOn.id);
    if (!n) return;
    const k = Math.max(viewRef.current.k, 1);
    setView({ k, x: size.w / 2 - n.x * k, y: size.h / 2 - n.y * k });
  }, [centerOn, size, shown.at]);

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
    // A tap selects a note (its card shows); a tap on the selected note opens it; a tap on empty space clears.
    if (!best) onSelect(null);
    else if (best.id === selected) onOpen(best.id);
    else onSelect(best.id);
  }

  const sp = (id: string) => {
    const n = shown.at.get(id)!;
    return { x: n.x * view.k + view.x, y: n.y * view.k + view.y };
  };

  // Labels that fit without overlapping, the most important first: the selected note, the one under
  // the pointer, the focus, what Find picked out, then the most connected. Found-out ones only when filtering.
  const labelText = (n: GraphNode) => (n.id === hot || n.id === selected ? displayTitle(n.title) : label(n.title));
  const order = useMemo(() => [...shown.nodes].sort((a, b) => b.degree - a.degree), [shown.nodes]);
  const labelled = (() => {
    const rank = (n: GraphNode) => (n.id === selected ? 0 : n.id === hot ? 1 : lens === "around" && n.id === focus ? 2 : matches?.has(n.id) ? 3 : 4);
    const items = order
      .filter((n) => !matches || matches.has(n.id) || n.id === hot || n.id === selected)
      .map((n, i) => ({ n, i, r: rank(n) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ n }) => {
        const p = sp(n.id);
        return { id: n.id, x: p.x + n.radius + 6, y: p.y - 9, w: labelWidth(labelText(n)) };
      })
      .filter((b) => size && b.x < size.w && b.x + b.w > 0 && b.y < size.h && b.y + 18 > 0); // off screen: no room taken
    const marks = shown.nodes.map((n) => ({ id: n.id, ...sp(n.id), r: n.radius + 2 }));
    return labelsToShow(items, 18, marks);
  })();
  const sel = selected ? (byId.get(selected) ?? null) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label={`Map of ${shown.nodes.length} ${shown.nodes.length === 1 ? "note" : "notes"}. Arrow keys pan, plus and minus zoom, 0 shows all. Tab moves between notes.`}
        onKeyDown={onKeyDown}
        className="relative min-h-0 bg-bg flex-1 touch-none select-none overflow-hidden border-t border-line outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-muted"
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
                const ends = edgeEnds(sp(e.source), sp(e.target), a.radius, b.radius);
                if (!ends) return null;
                const s = EDGE_STYLE[e.kind];
                const arrow = showArrow(e.kind, lens, view.k);
                const tri = (from: { x: number; y: number }, tip: { x: number; y: number }) => arrowHead(from, tip).map((q) => `${q.x},${q.y}`).join(" ");
                const lit = hot ? e.source === hot || e.target === hot : !matches || (matches.has(e.source) && matches.has(e.target));
                return (
                  <g key={`${e.kind}:${e.source}:${e.target}`} opacity={lit ? 1 : 0.14} className="transition-opacity duration-200">
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
                  aria-current={n.id === selected ? "true" : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (n.id === selected) onOpen(n.id);
                      else onSelect(n.id);
                    }
                  }}
                  onPointerEnter={() => setHot(n.id)}
                  onPointerLeave={() => setHot((h) => (h === n.id ? null : h))}
                  onFocus={() => setHot(n.id)}
                  onBlur={() => setHot((h) => (h === n.id ? null : h))}
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={near ? (near.has(n.id) ? 1 : 0.25) : !matches || matches.has(n.id) || n.id === selected ? 1 : 0.2}
                  className="cursor-pointer outline-none transition-opacity duration-200 [&:focus-visible>.ring]:stroke-fg"
                >
                  <circle className="ring" r={n.radius + 5} fill="none" stroke={n.id === selected ? "var(--fg)" : isFocus || hot === n.id ? "var(--muted)" : "transparent"} strokeWidth={n.id === selected ? 2 : 1.5} />
                  <NodeMark mark={n.mark} r={n.radius} />
                  {labelled.has(n.id) && (
                  <text
                    x={n.radius + 7}
                    y={4}
                    fontSize={12.5}
                    fontWeight={isFocus || n.id === selected ? 600 : undefined}
                    fill={n.title.trim() ? "var(--fg)" : "var(--muted)"}
                    stroke="var(--bg)"
                    strokeWidth={4}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {labelText(n)}
                  </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {sel && (
        <NoteCard
          node={sel}
          project={projectName(sel.project_id)}
          isFocus={lens === "around" && sel.id === focus}
          onOpen={() => onOpen(sel.id)}
          onAround={() => onAround(sel.id)}
          onClose={() => onSelect(null)}
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 sm:p-5">
        <div className="pointer-events-auto max-w-[min(100%,560px)] bg-bg/80 px-1">
          <Legend />
        </div>
        <div role="group" aria-label="Zoom" className="pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-md border border-line bg-bg">
          <MapControl label="Zoom in" onClick={() => size && setView(zoomAt(viewRef.current, ZOOM_STEP, size.w / 2, size.h / 2))}>
            <IconPlus />
          </MapControl>
          <MapControl label="Zoom out" onClick={() => size && setView(zoomAt(viewRef.current, 1 / ZOOM_STEP, size.w / 2, size.h / 2))}>
            <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M4.5 10h11" />
            </svg>
          </MapControl>
          <MapControl label="Show all" onClick={fit}>
            <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 7.5V5a1 1 0 0 1 1-1h2.5M12.5 4H15a1 1 0 0 1 1 1v2.5M16 12.5V15a1 1 0 0 1-1 1h-2.5M7.5 16H5a1 1 0 0 1-1-1v-2.5" />
            </svg>
          </MapControl>
        </div>
      </div>
    </div>
  );
}

const OUTCOME_WORD: Record<Mark, string> = { success: "Successful", failed: "Failed", unmarked: "Unmarked" };

/** The selected note's details, over the top of the map: what it is, and where to go from it. */
function NoteCard({ node, project, isFocus, onOpen, onAround, onClose }: { node: GraphNode; project?: string; isFocus: boolean; onOpen: () => void; onAround: () => void; onClose: () => void }) {
  return (
    <section
      aria-label={`${displayTitle(node.title)}: details`}
      className="absolute top-3 left-3 z-10 w-[min(360px,calc(100%-24px))] rounded-md border border-line bg-raise p-4 sm:top-5 sm:left-5"
    >
      <div className="flex items-start gap-3">
        <svg width={16} height={16} viewBox="-8 -8 16 16" aria-hidden className="mt-1.5 shrink-0">
          <NodeMark mark={node.mark} r={5} />
        </svg>
        <h2 className={cn("min-w-0 flex-1 font-display text-[19px] leading-snug", !node.title.trim() && "text-muted")}>{displayTitle(node.title)}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-tint hover:text-fg">
          <IconX className="size-4" />
        </button>
      </div>
      <p className="mt-1.5 pl-7 text-xs text-muted">
        {[OUTCOME_WORD[node.mark], project, `${node.degree} ${node.degree === 1 ? "connection" : "connections"}`].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 pl-7">
        <Button size="sm" onClick={onOpen}>
          Open note
        </Button>
        {!isFocus && (
          <Button size="sm" variant="soft" onClick={onAround}>
            Map around this
          </Button>
        )}
      </div>
    </section>
  );
}

/** Find a note, and show only some outcomes or one project: the rest fades. */
function MapToolbar({
  filter,
  onFilter,
  notes,
  projects,
  matched,
  onPick,
  inPicture,
}: {
  filter: MapFilter;
  onFilter: (f: MapFilter) => void;
  notes: GraphNode[];
  projects: { id: string; name: string }[];
  matched: number | null;
  onPick: (id: string) => void;
  inPicture: (id: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = filter.find.trim().toLowerCase();
  const found = q ? notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8) : [];
  const toggle = (m: Mark) => {
    const next = new Set(filter.marks);
    if (next.has(m) && next.size > 1) next.delete(m);
    else next.add(m);
    onFilter({ ...filter, marks: next });
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-[1_1_240px]">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          role="combobox"
          aria-expanded={open && found.length > 0}
          aria-controls="map-found"
          aria-label="Find a note on the map"
          placeholder="Find a note"
          value={filter.find}
          onChange={(e) => {
            onFilter({ ...filter, find: e.target.value });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && found[0]) {
              e.preventDefault();
              onPick(found[0].id);
              setOpen(false);
            }
          }}
          className="h-10 w-full rounded-xl border border-line bg-raise pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-faint"
        />
        {open && found.length > 0 && (
          <ul id="map-found" role="listbox" className="absolute top-11 right-0 left-0 z-20 overflow-hidden rounded-xl border border-line bg-raise shadow-float">
            {found.map((n) => (
              <li key={n.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(n.id);
                    setOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-tint"
                >
                  <svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden className="shrink-0">
                    <NodeMark mark={n.mark} r={4} />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">{displayTitle(n.title)}</span>
                  {!inPicture(n.id) && <span className="shrink-0 text-xs text-faint">Map around it</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div role="group" aria-label="Outcomes shown" className="flex items-center gap-1">
        {(["success", "failed", "unmarked"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={filter.marks.has(m)}
            onClick={() => toggle(m)}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 px-1.5 text-sm transition-colors",
              filter.marks.has(m) ? "text-fg" : "text-faint line-through decoration-faint/60",
            )}
          >
            {OUTCOME_WORD[m]}
          </button>
        ))}
      </div>
      {projects.length > 0 && (
        <select
          aria-label="Project shown"
          value={filter.project ?? ""}
          onChange={(e) => onFilter({ ...filter, project: e.target.value || null })}
          className="h-10 max-w-[200px] rounded-xl border border-line bg-raise px-3 text-xs text-fg outline-none focus:border-faint"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {matched !== null && (
        <span role="status" className="flex items-center gap-2 text-xs text-muted">
          {matched} {matched === 1 ? "match" : "matches"} in the picture
          <TextButton className="text-xs" onClick={() => onFilter(NO_FILTER)}>
            Clear
          </TextButton>
        </span>
      )}
    </div>
  );
}

function MapControl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center border-b border-line text-muted transition-colors last:border-b-0 hover:bg-fg/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/40"
    >
      {children}
    </button>
  );
}

/** Outcome as a dot: filled (successful), red (failed), hollow (unmarked). */
function NodeMark({ mark, r }: { mark: Mark; r: number }) {
  if (mark === "failed") return <circle r={r} fill="var(--fail)" />;
  if (mark === "success") return <circle r={r} fill="var(--fg)" />;
  return <circle r={r - 0.75} fill="var(--bg)" stroke="var(--fg)" strokeWidth={1.5} />;
}

/** Notes with no connection yet: listed under the picture, each opening its note. */
function LooseNotes({ nodes }: { nodes: GraphNode[] }) {
  return (
    <div className="shrink-0 border-t border-line bg-bg">
      <Column className="py-3">
        <p className="eyebrow">Not connected yet · {nodes.length}</p>
        <ul className="mt-1 max-h-40 overflow-y-auto">
          {nodes.map((n) => (
            <li key={n.id}>
              <Link href={`/n/${n.id}`} aria-label={n.label} className="flex min-h-10 items-center gap-2 text-sm hover:underline">
                <svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden className="shrink-0">
                  <NodeMark mark={n.mark} r={4} />
                </svg>
                <span className={cn("truncate", !n.title.trim() && "text-muted")}>{displayTitle(n.title)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Column>
    </div>
  );
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
    <ul aria-label="Key" className="flex flex-wrap items-center gap-x-3.5 gap-y-1 py-2 text-[11.5px] text-muted">
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
      <Link href={`/n/${n.id}`} aria-label={n.label} className="-mx-3 flex min-h-12 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-raise">
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
                <h2 className="eyebrow mt-6">{g.group}</h2>
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
