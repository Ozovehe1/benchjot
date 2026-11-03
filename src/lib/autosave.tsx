"use client";
// Autosave: each editor registers a debounced saver; a shared context
// aggregates their status for the header indicator and lets Ctrl+S flush all.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

interface SaveRegistry {
  state: SaveState;
  error: string | null;
  report: (id: string, state: SaveState, error?: string | null) => void;
  register: (id: string, flush: () => Promise<void>) => () => void;
  flushAll: () => Promise<void>;
}

const Ctx = createContext<SaveRegistry | null>(null);

const PRIORITY: SaveState[] = ["error", "saving", "pending", "saved", "idle"];

export function SaveStatusProvider({ children }: { children: React.ReactNode }) {
  const states = useRef(new Map<string, { state: SaveState; error: string | null }>());
  const flushers = useRef(new Map<string, () => Promise<void>>());
  const [summary, setSummary] = useState<{ state: SaveState; error: string | null }>({ state: "idle", error: null });

  const recompute = useCallback(() => {
    const all = [...states.current.values()];
    const top = PRIORITY.find((p) => all.some((s) => s.state === p)) ?? "idle";
    setSummary({ state: top, error: all.find((s) => s.state === "error")?.error ?? null });
  }, []);

  const report = useCallback(
    (id: string, state: SaveState, error: string | null = null) => {
      states.current.set(id, { state, error });
      recompute();
    },
    [recompute],
  );

  const register = useCallback(
    (id: string, flush: () => Promise<void>) => {
      flushers.current.set(id, flush);
      return () => {
        flushers.current.delete(id);
        states.current.delete(id);
        recompute();
      };
    },
    [recompute],
  );

  const flushAll = useCallback(async () => {
    await Promise.all([...flushers.current.values()].map((f) => f()));
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if ([...states.current.values()].some((s) => s.state === "pending" || s.state === "saving" || s.state === "error")) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const value = useMemo(
    () => ({ state: summary.state, error: summary.error, report, register, flushAll }),
    [summary, report, register, flushAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSaveStatus() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSaveStatus must be used inside SaveStatusProvider");
  return ctx;
}

/**
 * Debounced autosave of `value`. `save` receives the latest value; it runs
 * at most once at a time and again if the value changed while saving.
 * `baseline` is the value already persisted (e.g. just loaded).
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, opts: { delay?: number; baseline: T }) {
  const { report, register } = useSaveStatus();
  const id = useRef(Math.random().toString(36).slice(2)).current;
  const delay = opts.delay ?? 900;
  const serial = JSON.stringify(value);
  const saved = useRef(JSON.stringify(opts.baseline));
  const latest = useRef(value);
  const saveRef = useRef(save);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = value;
  saveRef.current = save;

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current) await inFlight.current;
    const v = latest.current;
    const s = JSON.stringify(v);
    if (s === saved.current) return;
    report(id, "saving");
    let ok = false;
    inFlight.current = (async () => {
      try {
        await saveRef.current(v);
        saved.current = s;
        ok = true;
        report(id, JSON.stringify(latest.current) === s ? "saved" : "pending");
      } catch (err) {
        report(id, "error", err instanceof Error ? err.message : "Could not save");
      } finally {
        inFlight.current = null;
      }
    })();
    await inFlight.current;
    // Typed more while saving: save again. After an error, wait for the next edit or Ctrl+S.
    if (ok && JSON.stringify(latest.current) !== saved.current) await flush();
  }, [id, report]);

  useEffect(() => register(id, flush), [id, register, flush]);

  useEffect(() => {
    if (serial === saved.current) return;
    report(id, "pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  }, [serial, delay, flush, id, report]);

  // Save whatever is pending when the editor goes away.
  useEffect(() => () => void flush(), [flush]);

  return { flush };
}
