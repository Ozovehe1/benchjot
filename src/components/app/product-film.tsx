"use client";
// The landing's product film: a replay of one real note (the sample run, 18 Nov 2026) in the app's own
// window, in four scenes: what was expected is written, the code runs on the server with its own
// progress lines, its table and figure arrive, and what happened is written next to what was expected.
// Everything shown is from that run (lib/sample-note.ts); only time is compressed, and it says so.
// It plays while on screen, pauses on hover, focus or the pause button, and a scene chip jumps to its
// scene. With reduced motion it shows the finished note, and the chips just move between its parts.
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/format";

export type FilmScene = { id: "expect" | "run" | "see" | "conclude"; title: string; caption: string };

export const FILM_SCENES: readonly FilmScene[] = [
  { id: "expect", title: "Expect", caption: "Write what you expect before you run anything." },
  { id: "run", title: "Run", caption: "Run it in the browser, or on a server with a GPU. It keeps going if you close the tab." },
  { id: "see", title: "See", caption: "Tables and figures are kept with the note. Export the whole note to Jupyter, a web page or Markdown." },
  { id: "conclude", title: "Conclude", caption: "Write what happened next to what you expected." },
];

/** How long each scene plays, then the pause on the finished note before it starts again. */
const SCENE_MS = [5200, 7600, 5600, 6400] as const;
const HOLD_MS = 3200;

export function ProductFilm({
  title,
  before,
  after,
  filename,
  progress,
  ranFor,
  where,
  code,
  outputs,
  outcome,
}: {
  title: string;
  before: string;
  after: string;
  filename: string;
  /** The run's own progress lines, in order. */
  progress: readonly string[];
  /** How long the code ran, e.g. "7:16". */
  ranFor: string;
  /** Where it ran, e.g. "the server's CPU". */
  where: string;
  code: React.ReactNode;
  outputs: React.ReactNode;
  outcome: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState(0);
  /** 0–1 through the current scene. */
  const [t, setT] = useState(1);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [visible, setVisible] = useState(false);
  const [still, setStill] = useState(true); // reduced motion (and before hydration): the finished note
  const clock = useRef({ scene: 0, start: 0, elapsed: 0 });

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setStill(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const playing = !still && visible && !paused && !hover;

  // The clock: one frame loop while playing; the scene and how far into it.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const c = clock.current;
    c.start = performance.now() - c.elapsed;
    const tick = (now: number) => {
      c.elapsed = now - c.start;
      const len = SCENE_MS[c.scene]! + (c.scene === SCENE_MS.length - 1 ? HOLD_MS : 0);
      if (c.elapsed >= len) {
        c.scene = (c.scene + 1) % SCENE_MS.length;
        c.elapsed = 0;
        c.start = now;
        setScene(c.scene);
      }
      setT(Math.min(1, c.elapsed / SCENE_MS[c.scene]!));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Starting to play from the finished note: from the top.
  useEffect(() => {
    if (!still) {
      Object.assign(clock.current, { scene: 0, start: performance.now(), elapsed: 0 });
      setScene(0);
      setT(0);
    } else setT(1);
  }, [still]);

  const go = useCallback((i: number) => {
    // In place: the running frame loop holds this object.
    Object.assign(clock.current, { scene: i, start: performance.now(), elapsed: 0 });
    setScene(i);
    setT(still ? 1 : 0);
  }, [still]);

  // The window follows the scene: the part it's about comes into view.
  useEffect(() => {
    const p = pane.current;
    const target = p?.querySelector<HTMLElement>(`[data-film="${FILM_SCENES[scene]!.id}"]`);
    if (!p || !target) return;
    // The first scene shows the note from its title; the last keeps the figure's end above the conclusion.
    const id = FILM_SCENES[scene]!.id;
    const top = id === "expect" ? 0 : id === "conclude" ? target.offsetTop - p.clientHeight * 0.45 : target.offsetTop - 24;
    p.scrollTo({ top: Math.max(0, top), behavior: still ? "auto" : "smooth" });
  }, [scene, still]);

  const id = FILM_SCENES[scene]!.id;
  const at = (s: FilmScene["id"]) => FILM_SCENES.findIndex((x) => x.id === s);
  /** Whether a scene is done (or this is the still, finished note). */
  const past = (s: FilmScene["id"]) => still || scene > at(s);
  const typed = (text: string, s: FilmScene["id"], from = 0.05, to = 0.85) =>
    past(s) ? text : id === s ? text.slice(0, Math.round(text.length * clamp((t - from) / (to - from)))) : "";
  const lines = past("run") ? progress.length : id === "run" ? Math.floor(progress.length * clamp((t - 0.18) / 0.7)) : 0;
  const running = id === "run" && !still && t < 0.9;
  const ran = past("run") || (id === "run" && t >= 0.9);
  const codeShown = past("expect") || id === "run";
  const shown = past("see") || (id === "see" && t > 0.08);
  const concluded = past("conclude") || (id === "conclude" && t > 0.9);
  const seconds = Math.round(parseClock(ranFor) * (past("run") ? 1 : id === "run" ? clamp((t - 0.1) / 0.8) : 0));

  return (
    <div ref={box} className="relative">
      {/* A soft light behind the window, so it reads as the thing to look at. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[8%] -top-16 h-72 rounded-full bg-fg/[0.06] blur-3xl" />
      <figure
        className="relative overflow-hidden rounded-2xl border border-line bg-bg shadow-float"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label="A replay of a real note in Benchjot"
      >
        <div className="flex h-[520px] sm:h-[600px]">
          {/* The app's sidebar, as in the app (wide screens). */}
          <aside aria-hidden className="hidden w-56 shrink-0 flex-col bg-shell px-3 py-4 md:flex">
            <p className="px-2 font-mono text-[13px] text-fg">benchjot</p>
            <ul className="mt-5 space-y-0.5 text-[13px] text-muted">
              {["All notes", "Figures", "Data", "Research map"].map((n, i) => (
                <li key={n} className={cn("rounded-lg px-2 py-1.5", i === 0 && "bg-tint text-fg")}>{n}</li>
              ))}
            </ul>
            <p className="eyebrow mt-6 px-2">Notes</p>
            <ul className="mt-2 space-y-0.5 text-[13px]">
              <li className="truncate rounded-lg bg-tint/60 px-2 py-1.5 text-fg">{title}</li>
            </ul>
          </aside>

          <div ref={pane} className="relative min-w-0 flex-1 overflow-hidden">
            <div className="mx-auto max-w-[760px] px-5 pb-[60%] pt-7 sm:px-10 sm:pt-10">
              <h3 className="font-display text-[26px] leading-tight tracking-[-0.01em] sm:text-[34px]">{title}</h3>
              <div className="mt-3 flex items-center gap-3 text-[13px] text-muted">
                <span>Outcome</span>
                <span className={cn("rounded-full px-2.5 py-0.5 transition-colors duration-500", concluded ? "bg-ok/15 text-ok" : "bg-tint text-faint")}>{concluded ? outcome : "Not yet"}</span>
              </div>

              <section data-film="expect" className="mt-8">
                <p className="eyebrow">Before run</p>
                <p className="mt-2 min-h-[4.5em] text-[15px] leading-relaxed text-fg/90">
                  {typed(before, "expect")}
                  {id === "expect" && !still && <Caret />}
                </p>
              </section>

              <section data-film="run" className={cn("mt-6 transition-opacity duration-500", codeShown ? "opacity-100" : "opacity-0")}>
                <div className="flex items-center justify-between font-mono text-xs text-muted">
                  <span>{filename} · Python</span>
                  <span className={cn("rounded-md px-2 py-1", running ? "bg-run/15 text-run" : ran ? "text-faint" : "bg-tint text-fg")}>{running ? "Running" : ran ? "Ran" : "Run"}</span>
                </div>
                <div className="relative mt-2 max-h-[190px] overflow-hidden rounded-xl bg-raise max-sm:[&_pre]:!text-[11.5px] max-sm:[&_code]:!text-[11.5px]">
                  {code}
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-raise to-transparent" />
                </div>
                <div className="mt-3 rounded-xl border border-line px-4 py-3 font-mono text-[11px] leading-[1.7] text-muted sm:text-[12px]">
                  <p className={cn(running && "shimmer-text")}>
                    {running ? `Running on ${where} · ${clockText(seconds)}` : ran ? `Ran for ${ranFor} on ${where}` : "Ready"}
                    {running && <span className="text-faint"> (sped up)</span>}
                  </p>
                  {progress.slice(0, lines).map((l) => (
                    <p key={l} className="text-fg/80 [animation:film-in_.35s_ease-out]">{l}</p>
                  ))}
                </div>
              </section>

              <section data-film="see" className={cn("mt-6 transition-all duration-700", shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}>
                {outputs}
              </section>

              <section data-film="conclude" className="mt-6">
                <p className="flex items-center gap-3">
                  <span className="eyebrow">After run</span>
                  <span className={cn("rounded-full bg-ok/15 px-2.5 py-0.5 text-[12px] text-ok transition-opacity duration-500", concluded ? "opacity-100" : "opacity-0")}>{outcome}</span>
                </p>
                <p className="mt-2 min-h-[6em] text-[15px] leading-relaxed text-fg/90">
                  {typed(after, "conclude", 0.05, 0.8)}
                  {id === "conclude" && !still && t < 0.85 && <Caret />}
                </p>
              </section>
            </div>
          </div>
        </div>
      </figure>

      {/* Scenes: where the film is, and a way to any part of it. */}
      <div className="mt-5 flex items-start gap-3">
        <ol className="grid flex-1 grid-cols-4 gap-2 sm:gap-4">
          {FILM_SCENES.map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => go(i)} aria-current={i === scene ? "step" : undefined} className="group block w-full text-left">
                <span className="block h-0.5 overflow-hidden rounded-full bg-line">
                  <span className="block h-full origin-left bg-fg" style={{ transform: `scaleX(${still || i < scene ? 1 : i === scene ? t : 0})`, opacity: i === scene ? 1 : 0.3 }} />
                </span>
                <span className={cn("mt-2.5 block text-[13px] transition-colors sm:text-[14px]", i === scene ? "text-fg" : "text-faint group-hover:text-muted")}>
                  <span className="mr-1.5 font-mono text-[11px] text-faint">0{i + 1}</span>
                  {s.title}
                </span>
                <span className={cn("mt-1 hidden text-[13px] leading-snug sm:block", i === scene ? "text-muted" : "text-faint/70")}>{s.caption}</span>
              </button>
            </li>
          ))}
        </ol>
        {!still && (
          <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play the replay" : "Pause the replay"} className="-mt-2 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-tint hover:text-fg">
            {paused ? (
              <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden><path d="M5 3.5v9l7-4.5z" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden><path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" /></svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1.1em] w-px translate-y-[0.2em] bg-fg [animation:film-caret_1s_steps(1)_infinite]" />;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const parseClock = (s: string) => s.split(":").reduce((a, p) => a * 60 + Number(p), 0);
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
