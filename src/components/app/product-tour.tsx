"use client";
// The landing's tour of a real note, top to bottom: the question, then each experiment (code cell)
// in turn: what was expected, the run, what it kept, what happened. Each step points at its part
// of the note beside it (NotePreview's data-part, inside data-cell for a cell's parts) and scrolls
// the note's frame there; the run step replays that cell's own run states. It plays once by itself
// when the note comes into view (not with reduced motion); any tap or scroll hands control to the
// visitor. Scrolling the note by hand moves the step and the experiment with it.
// Without scripts the note is still there, whole and scrollable.
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/format";

export type TourStep = {
  title: string;
  text: string;
  /** "question" is the note's top (title, outcome, body); the others are parts of a code cell. */
  part: "question" | "before" | "run" | "outputs" | "after";
  /** Where in the part to scroll to (a selector, e.g. its first figure); the whole part is highlighted. */
  focus?: string;
};

/** One experiment (code cell): its name and its run's states, for the run step's replay. */
export type TourCell = { label: string; replay: readonly string[] };

type Spot = { step: number; cell: number };

const STEP_MS = 4200;
const REPLAY_LINE_MS = 600;

export function ProductTour({
  steps,
  cells,
  intro,
  caption,
  children,
}: {
  steps: readonly TourStep[];
  cells: readonly TourCell[];
  intro: React.ReactNode;
  caption: React.ReactNode;
  children: React.ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [auto, setAuto] = useState(false);
  const [line, setLine] = useState<number | null>(null);
  /** The cell whose run replay plays: only a run step chosen or played, not one scrolled past. */
  const [replayFor, setReplayFor] = useState<number | null>(null);
  const reduced = useRef(false);
  /** While the tour itself scrolls the note, the scroll doesn't pick the step. */
  const steering = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spying = useRef(0);
  const isCellStep = (i: number) => steps[i]!.part !== "question";

  const target = useCallback(
    ({ step, cell }: Spot) => {
      const part = steps[step]!.part;
      const scope = part === "question" ? "" : `[data-cell="${cell}"] `;
      return frame.current?.querySelector<HTMLElement>(`${scope}[data-part="${part}"]`) ?? null;
    },
    [steps],
  );

  /** Highlights a spot's part (or none) and makes it the current one, without scrolling. */
  const mark = useCallback(
    (s: Spot | null) => {
      frame.current?.querySelectorAll("[data-tour-active]").forEach((el) => el.removeAttribute("data-tour-active"));
      if (s) target(s)?.setAttribute("data-tour-active", "");
      setSpot(s);
    },
    [target],
  );

  /** Goes to a spot: highlights its part and scrolls the note to it. */
  const show = useCallback(
    (s: Spot) => {
      const f = frame.current;
      const el = target(s);
      mark(s);
      setReplayFor(steps[s.step]!.part === "run" ? s.cell : null);
      if (!f || !el) return;
      if (steering.current) clearTimeout(steering.current);
      steering.current = setTimeout(() => (steering.current = null), reduced.current ? 50 : 900);
      const focus = steps[s.step]!.focus;
      const at = (focus && el.querySelector<HTMLElement>(focus)) || el;
      const top = at.getBoundingClientRect().top - f.getBoundingClientRect().top + f.scrollTop - 28;
      f.scrollTo({ top: Math.max(0, top), behavior: reduced.current ? "auto" : "smooth" });
    },
    [mark, steps, target],
  );

  /** Every part in the note's order: the question, then each cell's parts. */
  const order = useCallback((): Spot[] => {
    const question = steps.findIndex((s) => s.part === "question");
    const cellSteps = steps.map((_, i) => i).filter(isCellStep);
    return [...(question >= 0 ? [{ step: question, cell: 0 }] : []), ...cells.flatMap((_, cell) => cellSteps.map((step) => ({ step, cell })))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, steps]);

  /**
   * The visitor scrolled the note: the current spot is the last part whose top is above 40% of
   * the frame; at the very bottom, the last part in view (it can't scroll up that far).
   */
  const onScroll = useCallback(() => {
    if (steering.current) return;
    cancelAnimationFrame(spying.current);
    spying.current = requestAnimationFrame(() => {
      const f = frame.current;
      if (!f) return;
      const box = f.getBoundingClientRect();
      const atBottom = f.scrollTop + f.clientHeight >= f.scrollHeight - 4;
      const lineY = atBottom ? box.bottom : box.top + f.clientHeight * 0.4;
      let found: Spot | null = null;
      for (const s of order()) {
        const el = target(s);
        if (el && el.offsetHeight > 0 && el.getBoundingClientRect().top <= lineY) found = s;
      }
      setSpot((prev) => {
        if (prev?.step === found?.step && prev?.cell === found?.cell) return prev;
        frame.current?.querySelectorAll("[data-tour-active]").forEach((el) => el.removeAttribute("data-tour-active"));
        if (found) target(found)?.setAttribute("data-tour-active", "");
        return found;
      });
    });
  }, [order, target]);

  const takeOver = useCallback(() => setAuto(false), []);

  // Start once, from the top, the first time the note is half in view (on phones it's below the pitch).
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = frame.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([note]) => {
        if (!note?.isIntersecting) return;
        io.disconnect();
        show(order()[0]!);
        if (!reduced.current) setAuto(true);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [order, show]);

  // A run step, when chosen or played: that cell's run states one by one (all at once when motion
  // is reduced). Scrolled past, or left for another step, the replay goes away.
  const replay = replayFor === null ? [] : (cells[replayFor]?.replay ?? []);
  const replaying = spot !== null && replayFor === spot.cell && steps[spot.step]!.part === "run";
  useEffect(() => {
    if (!replaying) return setLine(null);
    if (reduced.current) return setLine(replay.length - 1);
    setLine(0);
    const t = setInterval(() => setLine((n) => (n === null || n >= replay.length - 1 ? n : n + 1)), REPLAY_LINE_MS);
    return () => clearInterval(t);
  }, [replaying, replay.length, replayFor]);

  const duration = (s: Spot) => (steps[s.step]!.part === "run" ? (cells[s.cell]?.replay.length ?? 0) * REPLAY_LINE_MS + 2000 : STEP_MS);

  // Autoplay: the next part in the note's order, after this one's time.
  useEffect(() => {
    if (!auto || !spot) return;
    const all = order();
    const at = all.findIndex((s) => s.step === spot.step && s.cell === spot.cell);
    const next = all[at + 1];
    const t = setTimeout(() => (next ? show(next) : setAuto(false)), duration(spot));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, spot, order, show]);

  /** A step's button: the question, or this step in the current experiment. */
  const choose = (step: number) => {
    takeOver();
    show({ step, cell: spot?.cell ?? 0 });
  };
  /** An experiment's button: the same step in that experiment (its first step from the question). */
  const chooseCell = (cell: number) => {
    takeOver();
    const step = spot && isCellStep(spot.step) ? spot.step : steps.findIndex((s) => s.part !== "question");
    show({ step, cell });
  };

  const active = spot?.step ?? null;
  const current = active === null ? null : steps[active]!;
  const inCell = active !== null && isCellStep(active);
  const progress = (i: number) => auto && spot && active === i && <Progress key={`${spot.step}-${spot.cell}`} ms={duration(spot)} />;

  const cellSwitch = (
    <div role="group" aria-label="Experiment" className="flex items-center gap-1 text-[13px]">
      <span className="mr-1 text-faint">Experiment</span>
      {cells.map((c, i) => (
        <button
          key={c.label}
          type="button"
          onClick={() => chooseCell(i)}
          aria-pressed={inCell && spot?.cell === i}
          className={cn("min-h-9 rounded-md px-2.5 font-mono text-[12px] transition-colors", inCell && spot?.cell === i ? "bg-tint text-fg" : "text-muted hover:text-fg")}
        >
          {i + 1} · {c.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-16">
      <div className="lg:sticky lg:top-10">
        {intro}
        <div className="mt-12 hidden lg:block">
          {cellSwitch}
          <ol aria-label="A note, step by step" className="mt-2 space-y-1">
            {steps.map((s, i) => (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => choose(i)}
                  aria-pressed={active === i}
                  className={cn("group relative block w-full rounded-lg px-4 py-3 text-left transition-colors", active === i ? "bg-tint" : "hover:bg-tint/50")}
                >
                  <span className="flex items-baseline gap-3">
                    <span className="font-mono text-[12px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                    <span className={cn("font-medium", active === i ? "text-fg" : "text-muted group-hover:text-fg")}>{s.title}</span>
                  </span>
                  <span className={cn("mt-1 block pl-8 text-[14px] leading-relaxed text-muted", active === i ? "" : "sr-only")}>{s.text}</span>
                  {progress(i)}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-12 lg:mt-0">
        {/* Phones: the steps stay at the top of the screen while the note is read. */}
        <div className="sticky top-0 z-20 -mx-5 bg-bg/95 px-5 pt-2 lg:hidden">
          <div role="group" aria-label="A note, step by step" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => choose(i)}
                aria-pressed={active === i}
                className={cn("relative min-h-12 overflow-hidden rounded-lg text-[12px] transition-colors", active === i ? "bg-tint font-medium text-fg" : "text-muted")}
              >
                <span className="block font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
                {progress(i)}
              </button>
            ))}
          </div>
          <div className="mt-1">{cellSwitch}</div>
          <p aria-live="polite" className="mt-1 min-h-[4.5em] pb-2 text-[14px] leading-relaxed text-muted">
            {current?.text ?? "A real note, from the top. Tap a step, scroll the note, or watch."}
          </p>
        </div>

        <figure aria-label="Sample note" className="card mt-3 overflow-hidden lg:mt-0">
          <figcaption className="flex items-center gap-3 border-b border-line bg-tint/50 px-4 py-2.5 sm:px-5">{caption}</figcaption>
          <div
            ref={frame}
            onScroll={onScroll}
            onWheel={takeOver}
            onTouchStart={takeOver}
            onKeyDown={takeOver}
            tabIndex={0}
            aria-label="The note"
            className="relative h-[64svh] max-h-[760px] overflow-y-auto px-4 pb-10 outline-none sm:px-5 lg:h-[calc(100svh-9rem)] lg:max-h-[880px]"
          >
            {line !== null && (
              <div aria-live="polite" className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 font-mono text-[12px] sm:-mx-5 sm:px-5">
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-fg", line < replay.length - 1 && "animate-pulse")} />
                <span className="truncate">{replay[line]}</span>
              </div>
            )}
            {children}
          </div>
        </figure>
      </div>
    </div>
  );
}

/** How long until the next step, while the tour plays by itself. */
function Progress({ ms }: { ms: number }) {
  return (
    <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
      <span className="tour-progress block h-full bg-fg/40" style={{ animationDuration: `${ms}ms` }} />
    </span>
  );
}
