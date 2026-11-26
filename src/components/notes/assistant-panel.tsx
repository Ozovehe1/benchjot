"use client";
// The note's assistant: one conversation, one Send (typed or spoken). Every request goes to the
// agent (lib/ai/agent.ts), which answers in words or does the work in the note itself: it writes
// and runs code cells, reads what they gave, fixes what failed, and writes into the note's text when
// asked. The thread reads like a chat with a colleague who works in your notebook:
//   - your message on the right; the reply as plain text, full width;
//   - while it works, one live line says what it's doing and for how long, with each thing done in
//     the note listed under it as it happens (tap one to go to that cell);
//   - when it's done, the work folds into one line ("Worked 41 s · ran 2 cells") above the answer,
//     with Copy, Undo (everything it changed, in one tap) and Delete under it;
//   - the composer: a growing box, the microphone, and one round button that sends, or stops.
// The conversation is kept with the note (assistant_turns, 30 days, then a summary) and sent with each
// request, so "insert it" or "undo that" mean what you'd expect. The panel can close while it
// works; a bar at the bottom of the page says what it's doing.
import { addDatasetFromUrl, listDatasets } from "@/lib/data/datasets";
import { findDatasetsForAgent } from "@/lib/data/dataset-search";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiUsedText } from "@/lib/ai/budget";
import { agentSummary, hasChanges, keptChanges, runAgent, undoAgent, undoFromKept, type ActionDetail, type AgentAction, type AgentNote, type AgentPlan, type AgentState, type AgentUndo, type NoteProposal, type AgentCheckpoint } from "@/lib/ai/agent";
import { useApplyProposal } from "./proposal-context";
import { dropRun, keepRun, keptRun, LEAVING } from "@/lib/ai/agent-resume";
import { diffHunks, lineDiff } from "@/lib/ai/fix";
import { ASSISTANT_HISTORY, ASSISTANT_LIMITS, ASSISTANT_SUGGESTIONS, followUps, headCut, assistantHistory, type AssistantAnswer, type LatestRun, type SavedTurn } from "@/lib/ai/assistant";
import { useAiModel } from "@/lib/ai/model-choice";
import { MODELS, WHAT } from "../account/ai-model";
import { AI_MODEL_NAMES, type AiModel } from "@/config/app";
import { clearAssistant, deleteAssistantTurn, loadAssistantHistory, resaveAssistantTurn, saveAssistantTurn } from "@/lib/data";
import { copyText } from "@/lib/ui/copy";
import { cn } from "@/lib/ui/format";
import { useKeyboardInset } from "@/lib/ui/use-keyboard-inset";
import { canListen, useSpeech } from "@/lib/ui/use-speech";
import { userMessage } from "@/lib/ui/user-message";
import { isLanguageId } from "@/lib/code/languages";
import { StaticCode } from "../code/static-code";
import { Actions, ActivityList, Composer, CopyAction, duration, Finished, IconAction, ModelTrigger, Narration, PlanList, Reply, RoundButton, UserMessage, WorkingLine } from "./assistant-parts";
import { IconCheck, IconChevron, IconCopy, IconMic, IconSend, IconStop, IconTrash, IconUndo, IconX, MoreMenu, Notice, Spinner } from "../ui";
import { Markdown } from "../ui/markdown";

interface Props {
  noteId: string;
  open: boolean;
  onClose: () => void;
  /** The note's most recent run, so the assistant can offer to follow up on it. */
  latest: LatestRun | null;
  /** The note as the agent reads and changes it. */
  agentNote: AgentNote;
  /** Stops every cell's run in flight (Stop). */
  stopCells: () => void;
  /** Opens the panel again (the bar at the bottom of the page while it works). */
  onOpen: () => void;
  /** Scrolls the note to a cell (a line in the activity list). */
  onGoToCell: (id: string) => void;
  /** Told when a request starts and ends (the note marks the cell it works on meanwhile). */
  onWorking?: (on: boolean) => void;
  /** The note's cells are on the page, so a request left mid-way can be picked up again. */
  ready?: boolean;
}

/** One request in this session: what was asked, how the agent is doing, and what Undo puts back. */
interface Run {
  id: number;
  request: string;
  voice: boolean;
  at: string;
  ended?: string;
  state: AgentState;
  undo: AgentUndo;
  undone?: "working" | "done" | "failed";
  /** Its assistant_turns row once saved (hides the saved copy when the history is read again). */
  saved?: SavedTurn;
}

type ThreadItem = { at: string; key: string; saved?: SavedTurn; run?: Run };

const seconds = (from: string, to?: string) => Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));

export function AssistantPanel({ noteId, open, onClose, latest, agentNote, stopCells, onOpen, onGoToCell, onWorking, ready = true }: Props) {
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState<SavedTurn[]>([]);
  const [summary, setSummary] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const field = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const inset = useKeyboardInset();
  const sheet = useSheetSize(onClose);
  // The day's allowance, so a long request doesn't use it up unseen: this account's AI requests in
  // the last 24 hours (Benchjot's own count). Read on open and after each request.
  const [aiUsed, setAiUsed] = useState<number | null>(null);
  const busy = runs.some((r) => r.state.status === "working");
  useEffect(() => {
    if (!open || busy) return;
    let live = true;
    fetch("/api/usage", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ ai_own_24h?: number }>) : null))
      .then((u) => live && typeof u?.ai_own_24h === "number" && setAiUsed(u.ai_own_24h), () => {});
    return () => void (live = false);
  }, [open, busy]);
  const working = runs.find((r) => r.state.status === "working");
  const note = useRef(agentNote);
  note.current = agentNote;
  // The note as of the latest render, whenever the agent asks (a request outlives many renders).
  const liveNote = useRef<AgentNote>({
    read: () => note.current.read(),
    add: (l, c) => note.current.add(l, c),
    setCode: (id, c) => note.current.setCode(id, c),
    run: (id, where) => note.current.run(id, where),
    see: (id, signal) => note.current.see?.(id, signal) ?? Promise.resolve(),
    others: { find: (q, from) => note.current.others?.find(q, from) ?? Promise.resolve([]), open: (id) => note.current.others?.open(id) ?? Promise.resolve(null) },
    remove: (id) => note.current.remove(id),
    setBody: (t) => note.current.setBody(t),
    data: { list: () => listDatasets(), save: (url, name) => addDatasetFromUrl(url, name), find: (q) => findDatasetsForAgent(q) },
  }).current;
  const speech = useSpeech((text) => void send(text, true));
  const listening = speech.state.state === "listening" ? speech.state : null;
  const [micShown, setMicShown] = useState(false);
  useEffect(() => setMicShown(canListen()), []);

  useEffect(() => {
    if (open) field.current?.focus();
    // On a wide screen the note makes room for the panel (globals.css .assistant-open), so you watch it work.
    document.documentElement.classList.toggle("assistant-open", open);
    return () => document.documentElement.classList.remove("assistant-open");
  }, [open]);
  // Below full height on a phone, the page gets room at its end, so all of the note can scroll above the sheet.
  const half = open && sheet.height < FULL;
  useEffect(() => {
    document.documentElement.classList.toggle("assistant-half", half);
    return () => document.documentElement.classList.remove("assistant-half");
  }, [half]);
  const tell = useRef(onWorking);
  tell.current = onWorking;
  const isWorking = !!working;
  useEffect(() => {
    tell.current?.(isWorking);
  }, [isWorking]);

  // Each open reads the conversation again (it may have moved on, on the phone).
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadAssistantHistory(noteId).then(
      (h) => live && (setSaved(h.turns), setSummary(h.summary)),
      (e: unknown) => live && setNotice(userMessage(e, "history_load")),
    );
    return () => void (live = false);
  }, [open, noteId]);

  // The phone's Back closes the sheet, as it closes any sheet, instead of leaving the note (which
  // ended the Assistant's work with the page). The open sheet is one step in the history.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const state = (window.history.state ?? {}) as Record<string, unknown>;
    window.history.pushState({ ...state, bjSheet: true }, "");
    const onPop = () => closeRef.current();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed some other way (X, Escape, a tap on the note): its history step goes too.
      if ((window.history.state as { bjSheet?: boolean } | null)?.bjSheet) window.history.back();
    };
  }, [open]);

  // Leaving the note while it works: it stops cleanly (its turn is kept with what it did, so Undo
  // still works), rather than carrying on without the page it works in.
  // Leaving the page stops the request for now; what it reached is kept (agent-resume) to go on next time.
  useEffect(() => () => abort.current?.abort(LEAVING), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const thread = useMemo<ThreadItem[]>(() => {
    const mine = new Set(runs.map((r) => r.saved?.id).filter(Boolean));
    return [
      ...saved.filter((t) => !mine.has(t.id)).map((t) => ({ at: t.created_at, key: `s${t.id}`, saved: t })),
      ...runs.map((r) => ({ at: r.at, key: `r${r.id}`, run: r })),
    ].sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  }, [saved, runs]);

  // New words in the thread: keep the newest in view.
  const lastState = working ? `${working.state.steps.length}:${working.state.status === "working" ? working.state.doing : ""}` : "";
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread.length, lastState]);

  const setRun = (id: number, patch: Partial<Run>) => setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const runsRef = useRef(runs);
  runsRef.current = runs;

  /** The conversation so far, oldest first, as the agent reads it. */
  function conversation() {
    const undid = "\n\nThe user undid everything this changed.";
    const fromSaved = thread.flatMap((e) => {
      if (!e.saved) return [];
      const a = e.saved.answer;
      return [{ task: e.saved.task, request: e.saved.request, answer: a.kind === "prose" && a.undone ? { ...a, text: a.text + undid } : a }];
    });
    const fromRuns = thread.flatMap((e) => (e.run && e.run.state.status !== "working" ? [{ task: "ask" as const, request: e.run.request, answer: { kind: "prose" as const, text: agentSummary(e.run.state.steps) + (e.run.undone === "done" ? undid : "") } }] : []));
    return assistantHistory(summary, [...fromSaved, ...fromRuns]);
  }

  /** The cells the assistant wrote and hasn't undone (it's told which cells are its own). */
  function ownCells(): Set<string> {
    const ids = new Set<string>();
    for (const t of saved) if (t.answer.kind === "prose" && t.answer.changes && !t.answer.undone) t.answer.changes.added.forEach((id) => ids.add(id));
    for (const r of runs) if (r.undone !== "done") r.undo.added.forEach((id) => ids.add(id));
    return ids;
  }

  /** Send (typed or spoken): the agent answers, or does the work in the note. One request at a time. */
  async function send(text: string, voice = false) {
    const request = text.trim().slice(0, ASSISTANT_LIMITS.maxRequestChars);
    if (!request || working) return;
    setInput("");
    const run: Run = { id: nextId.current++, request, voice, at: new Date().toISOString(), state: { status: "working", steps: [], doing: "Reading the note…", step: 1 }, undo: { added: [], changed: [], note: [] } };
    setRuns((rs) => [...rs, run]);
    await drive(run, conversation(), ownCells());
  }

  // A request left mid-way (another page, a reload, the tab closed): picked up again from its last step
  // once the note's cells are on the page, whether or not the panel is open.
  const resumed = useRef(false);
  useEffect(() => {
    if (!ready || resumed.current) return;
    const kept = keptRun(noteId);
    if (!kept) {
      resumed.current = true;
      return;
    }
    // The cells register their controls after they render: a moment, then go on.
    const t = setTimeout(() => {
      if (resumed.current) return;
      resumed.current = true;
      const run: Run = { id: nextId.current++, request: kept.request, voice: kept.voice, at: kept.at, state: { status: "working", steps: kept.checkpoint.shown, doing: "Picking up where it left off…", step: kept.checkpoint.sent.length + 1, ...(kept.checkpoint.plan ? { plan: kept.checkpoint.plan } : {}) }, undo: kept.undo };
      setRuns((rs) => [...rs, run]);
      void drive(run, kept.history, new Set(kept.mine), kept.checkpoint);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the note is ready
  }, [ready, noteId]);

  async function drive(run: Run, history: ReturnType<typeof conversation>, mine: Set<string>, resume?: AgentCheckpoint) {
    setNotice(null);
    const id = run.id;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const { requestAgentStep } = await import("@/lib/run/server-client");
    let final: AgentState;
    try {
      final = await runAgent(run.request, liveNote, (body, signal) => requestAgentStep(body, signal), (state) => setRun(id, { state }), run.undo, ctrl.signal, history, mine, {
        ...(resume ? { resume } : {}),
        onCheckpoint: (checkpoint) => keepRun(noteId, { request: run.request, voice: run.voice, at: run.at, undo: run.undo, history, mine: [...mine], checkpoint }),
      });
    } catch (e) {
      const steps = (e as { steps?: AgentState["steps"] } | null)?.steps ?? [];
      const plan = (e as { plan?: AgentPlan } | null)?.plan;
      final = { status: "failed", steps, message: userMessage(e, "agent"), ...(plan ? { plan } : {}) };
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
    // The page was left: kept as it is to go on next time, not ended.
    if (ctrl.signal.aborted && ctrl.signal.reason === LEAVING) return;
    dropRun(noteId);
    const ended = new Date().toISOString();
    setRun(id, { state: final, ended });
    // Kept with the note: what was asked, what it did (so the thread reads the same after a reload),
    // its answer, and what Undo needs (so Undo still works after a reload). Stopped and failed
    // requests that changed something are kept too, so their Undo isn't lost.
    const changed = hasChanges(keptChanges(run.undo));
    if (final.status === "done" || changed) {
      const answer = keptAnswer(final, run, ended);
      saveAssistantTurn(noteId, { task: "ask", request: run.request, answer }).then(
        async (savedId) => {
          const saved: SavedTurn = { id: savedId, task: "ask", request: run.request, answer, created_at: run.at };
          setRun(id, { saved });
          // Undone before it finished saving: the kept turn says so too, or a reload would offer Undo again
          // and put back code over what the user has written since.
          if (runsRef.current.find((r) => r.id === id)?.undone === "done" && answer.kind === "prose") {
            const undone = { ...answer, undone: true };
            const again = await resaveAssistantTurn(noteId, saved, undone).catch(() => null);
            if (again) setRun(id, { saved: { ...saved, id: again, answer: undone } });
          }
        },
        (e: unknown) => setNotice(userMessage(e, "history_save")),
      );
    }
  }

  function stop() {
    abort.current?.abort();
    abort.current = null;
    stopCells();
  }

  /** Undo, for a request of this session: everything it changed goes back; the kept turn says so. */
  async function undo(run: Run) {
    setRun(run.id, { undone: "working" });
    try {
      await undoAgent(liveNote, run.undo);
      setRun(run.id, { undone: "done" });
      if (run.saved?.answer.kind === "prose") {
        const answer = { ...run.saved.answer, undone: true };
        const id = await resaveAssistantTurn(noteId, run.saved, answer);
        setRun(run.id, { saved: { ...run.saved, id, answer } });
      }
    } catch {
      setRun(run.id, { undone: "failed" });
    }
  }

  /** Undo, for a request kept from before (after a reload): from what was kept with its turn. */
  const [undoing, setUndoing] = useState<Record<string, "working" | "failed">>({});
  async function undoSaved(turn: SavedTurn) {
    if (turn.answer.kind !== "prose" || !turn.answer.changes) return;
    setUndoing((u) => ({ ...u, [turn.id]: "working" }));
    try {
      await undoAgent(liveNote, undoFromKept(turn.answer.changes));
      const answer = { ...turn.answer, undone: true };
      const id = await resaveAssistantTurn(noteId, turn, answer);
      setSaved((ts) => ts.map((t) => (t.id === turn.id ? { ...t, id, answer } : t)));
      setUndoing((u) => (({ [turn.id]: _, ...rest }) => rest)(u));
    } catch {
      setUndoing((u) => ({ ...u, [turn.id]: "failed" }));
    }
  }

  function remove(item: ThreadItem) {
    setNotice(null);
    const id = item.saved?.id ?? item.run?.saved?.id;
    const drop = () => {
      if (item.saved) setSaved((s) => s.filter((t) => t.id !== item.saved!.id));
      if (item.run) setRuns((rs) => rs.filter((r) => r.id !== item.run!.id));
    };
    if (!id) return drop();
    deleteAssistantTurn(id).then(drop, (e: unknown) => setNotice(userMessage(e, "history_clear")));
  }

  // Clearing can't be undone (there's no Recently Deleted for turns), so it asks first, as the
  // platforms ask before any action that destroys data for good.
  async function clearAll() {
    if (!window.confirm("Clear this conversation? Its turns and summary are deleted for good. This can’t be undone.")) return;
    setNotice(null);
    try {
      await clearAssistant(noteId);
      setSaved([]);
      setRuns((rs) => rs.filter((r) => r.state.status === "working"));
      setSummary("");
    } catch (e) {
      setNotice(userMessage(e, "history_clear"));
    }
  }

  async function insertCode(code: string, language: string) {
    try {
      const id = await liveNote.add(isLanguageId(language) ? language : "python", code);
      onClose();
      onGoToCell(id);
    } catch (e) {
      setNotice(userMessage(e, "upload"));
    }
  }

  const empty = thread.length === 0 && !summary;
  const lastAsked = Math.max(0, ...thread.map((e) => Date.parse(e.at) || 0));
  const recent = latest && (!lastAsked || Date.parse(latest.ranAt) > lastAsked) ? followUps(latest) : [];
  // The last run's follow-ups first; the general starters fill in (one "what next" is enough).
  const starters = [...recent, ...ASSISTANT_SUGGESTIONS.filter((l) => !(recent.length && /next/i.test(l))).map((l) => ({ label: l, request: l }))].slice(0, 3);

  return (
    <>
      {!open && working && (
        <div className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 mx-auto flex max-w-xl items-center gap-3 rounded-full border border-line bg-raise/95 py-1.5 pl-4 pr-1.5 shadow-float">
          <span aria-hidden className="breathe size-2 shrink-0 rounded-full bg-fg" />
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-sm">
            <span className="shimmer-text">{working.state.status === "working" ? working.state.doing : ""}</span>
          </button>
          <RoundButton label="Stop" onClick={stop} tone="neutral">
            <IconStop className="size-4" />
          </RoundButton>
        </div>
      )}
      <div hidden={!open} className={cn("fixed inset-0 z-40 sm:pointer-events-none sm:left-auto sm:w-[480px]", sheet.height < FULL && "pointer-events-none")}>
        {/* On a phone the sheet covers the note; on a wider screen it sits beside it, so you watch it work. */}
        {/* Below full height the note stays fully usable above the sheet (read it, scroll it, watch the
            assistant work in it); at full height it's dimmed and a tap on it closes the sheet. */}
        {sheet.height >= FULL && <div aria-hidden className="absolute inset-0 bg-bg/60 sm:hidden" onClick={onClose} />}
        <div
          role="dialog"
          aria-labelledby="assistant-title"
          style={{ bottom: inset, ["--sheet-h" as string]: `calc(${sheet.height * 100}dvh - ${inset}px)` }}
          className={cn(
            "pointer-events-auto absolute inset-x-0 flex h-[var(--sheet-h)] flex-col rounded-t-3xl border-t border-line bg-bg shadow-float sm:pointer-events-auto sm:inset-x-0 sm:top-0 sm:h-auto sm:rounded-none sm:border-l sm:border-t-0",
            !sheet.dragging && "transition-[height] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          {/* The handle: drag it (or the header) up or down to size the sheet; it settles at half or full
              height, and dragged well down it closes. A tap, or the arrow keys, switch half and full. */}
          <button
            type="button"
            aria-label={sheet.height < FULL ? "Make the panel taller" : "Make the panel shorter"}
            onClick={sheet.toggle}
            onKeyDown={(e) => (e.key === "ArrowUp" ? (e.preventDefault(), sheet.set(FULL)) : e.key === "ArrowDown" ? (e.preventDefault(), sheet.set(HALF)) : undefined)}
            {...sheet.drag}
            className="flex h-6 w-full shrink-0 touch-none items-center justify-center rounded-t-3xl outline-none focus-visible:ring-2 focus-visible:ring-fg/40 sm:hidden"
          >
            <span aria-hidden className="h-1 w-10 rounded-full bg-line" />
          </button>
          <header {...sheet.drag} className="flex min-h-12 shrink-0 touch-none items-center gap-1 px-4 sm:min-h-14 sm:touch-auto">
            <h2 id="assistant-title" className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">
              Assistant
            </h2>
            {!empty && !working && <MoreMenu label="Conversation options" items={[{ label: "Clear conversation", onSelect: () => void clearAll() }]} />}
            {/* Close: top left on a phone's sheet (Apple's sheet layout), top right on the side panel. */}
            <span className="-order-1 flex sm:order-none">
              <IconAction label="Close" onClick={onClose}>
                <IconX className="size-[18px]" />
              </IconAction>
            </span>
          </header>

          <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-4 [overscroll-behavior:contain]">
            {empty && (
              <section aria-label="Start" className="flex min-h-full flex-col justify-end pb-6 pt-10">
                <p className="text-[22px] font-medium leading-snug tracking-[-0.01em] text-fg">What should we do with this note?</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">Ask a question, or say what to do. Undo puts everything back.</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {starters.map(({ label, request }) => (
                    <button key={label} type="button" onClick={() => void send(request)} className="min-h-10 rounded-full border border-line px-4 text-left text-sm text-fg transition-colors hover:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40">
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {summary && (
              <details className="group border-b border-line py-3 text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-muted [&::-webkit-details-marker]:hidden">
                  <IconChevron className="size-3.5 transition-transform group-open:rotate-90" />
                  Earlier, condensed after {ASSISTANT_HISTORY.days} days
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-muted">{summary}</p>
              </details>
            )}
            <div className="space-y-6 py-4">
              {thread.map((e) => (
                <div key={e.key} className="space-y-3">
                  <UserMessage text={e.saved?.request ?? e.run!.request} voice={!!e.run?.voice} />
                  {e.saved && <SavedReply turn={e.saved} onInsert={insertCode} onUndo={() => void undoSaved(e.saved!)} undoing={undoing[e.saved.id]} onDelete={() => remove(e)} onGoToCell={(id) => (onClose(), onGoToCell(id))} />}
                  {e.run && <RunReply run={e.run} onUndo={() => void undo(e.run!)} onRetry={working ? undefined : () => void send(e.run!.request)} onDelete={() => remove(e)} onGoToCell={(id) => (onClose(), onGoToCell(id))} />}
                </div>
              ))}
            </div>
            <div ref={end} />
          </div>

          <div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
            {notice && <Notice className="mb-2" onDismiss={() => setNotice(null)}>{notice}</Notice>}
            {speech.state.state === "denied" && <Notice className="mb-2" onDismiss={speech.clear}>{speech.state.message}</Notice>}
            {!empty && !working && recent.length > 0 && (
              <div aria-label="Follow up on your last run" className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
                {recent.map((f) => (
                  <button key={f.label} type="button" onClick={() => void send(f.request)} className="min-h-9 shrink-0 rounded-full border border-line px-3.5 text-sm text-fg transition-colors hover:bg-tint">
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            <Composer
              field={field}
              value={listening ? listening.heard : input}
              listening={listening ? listening.seconds : null}
              onChange={setInput}
              onSend={() => void send(input)}
              working={!!working}
              onStop={stop}
              mic={micShown ? { start: () => (speech.clear(), speech.start()), finish: speech.finish, cancel: speech.cancel } : null}
            />
            <ChatModel used={aiUsed} />
          </div>
        </div>
      </div>
    </>
  );
}


/** What a finished request keeps with its turn: the summary the history reads, its answer, how it went, and what Undo needs. */
function keptAnswer(final: AgentState, run: Run, ended: string): AssistantAnswer {
  const said = final.steps.map((st) => st.message.trim()).filter(Boolean);
  const answer = final.status === "done" ? (said.at(-1) ?? "") : final.status === "failed" ? final.message : "Stopped.";
  // Within what the kept turn allows (lib/ai/assistant.ts agentLog), or it couldn't be read back.
  const narration = (final.status === "done" ? said.slice(0, -1) : said).slice(-12).map((m) => headCut(m, 4_000));
  const actions = final.steps.flatMap((st) => st.actions).slice(-60).map((a) => ({ ...a, text: headCut(a.text, 300) }));
  const changes = keptChanges(run.undo);
  const log = { secs: seconds(run.at, ended), narration, actions, ...(final.plan ? { plan: final.plan } : {}) };
  // A turn is kept within 200 KB: the oldest steps' details go first when it would be more.
  for (let i = 0; JSON.stringify({ log, changes }).length > 150_000 && i < log.actions.length; i++) log.actions[i] = { ...log.actions[i]!, detail: undefined };
  const kept: AssistantAnswer = { kind: "prose", text: agentSummary(final.steps), answer, log };
  return hasChanges(changes) ? { ...kept, changes } : kept;
}

/** A reply read back from the conversation kept with the note. */
function SavedReply({ turn, onInsert, onUndo, undoing, onDelete, onGoToCell }: { turn: SavedTurn; onInsert: (code: string, language: string) => void; onUndo: () => void; undoing?: "working" | "failed"; onDelete: () => void; onGoToCell: (id: string) => void }) {
  const a = turn.answer;
  if (a.kind === "prose" && a.log) {
    // A request the agent carried out: shown as it was when it finished, Undo included.
    return (
      <Finished
        secs={a.log.secs}
        narration={a.log.narration}
        actions={a.log.actions}
        plan={a.log.plan}
        answer={a.answer ?? ""}
        canUndo={hasChanges(a.changes) && !a.undone}
        undone={a.undone ? "done" : undoing}
        onUndo={onUndo}
        onDelete={onDelete}
        onGoToCell={onGoToCell}
      />
    );
  }
  const text = a.kind === "code" ? a.summary : a.text;
  return (
    <div className="space-y-3">
      {text && <Reply text={text} />}
      {a.kind === "code" && (
        <div className="max-h-[320px] overflow-auto rounded-xl border border-line px-3">
          <StaticCode code={a.code} language={a.language} label="Code from an earlier answer" />
        </div>
      )}
      <Actions>
        {a.kind === "code" && <IconAction label="Insert as a new cell" onClick={() => onInsert(a.code, a.language)}><IconCode /></IconAction>}
        <CopyAction text={a.kind === "code" ? a.code : a.text} />
        <IconAction label="Delete" onClick={onDelete}><IconTrash className="size-4" /></IconAction>
      </Actions>
    </div>
  );
}

const IconCode = () => <span aria-hidden className="font-mono text-[11px] font-medium">{"</>"}</span>;

/** A request the agent is working on, or has finished. */
function RunReply({ run, onUndo, onRetry, onDelete, onGoToCell }: { run: Run; onUndo: () => void; onRetry?: () => void; onDelete: () => void; onGoToCell: (id: string) => void }) {
  const s = run.state;
  const actions = s.steps.flatMap((st) => st.actions);
  const said = s.steps.map((st) => st.message.trim()).filter(Boolean);
  const now = useTicker(s.status === "working");
  const secs = seconds(run.at, s.status === "working" ? new Date(now).toISOString() : run.ended);
  if (s.status === "working") {
    return (
      <div className="space-y-3">
        {s.plan && <PlanList plan={s.plan} working />}
        {said.length > 0 && <Narration text={said.at(-1)!} />}
        {/* Before its first words: the shape of the reply that's coming, not a spinner. */}
        {said.length === 0 && actions.length === 0 && !s.plan && (
          <div aria-hidden className="space-y-2 pt-0.5">
            <div className="skeleton h-3 w-[92%] rounded" />
            <div className="skeleton h-3 w-[78%] rounded" />
            <div className="skeleton h-3 w-[54%] rounded" />
          </div>
        )}
        <ActivityList actions={actions} onGoToCell={onGoToCell} />
        <WorkingLine doing={s.doing} secs={secs} />
      </div>
    );
  }
  return (
    <Finished
      secs={secs}
      narration={s.status === "done" ? said.slice(0, -1) : said}
      actions={actions}
      plan={s.plan}
      answer={s.status === "done" ? (said.at(-1) ?? "") : ""}
      failed={s.status === "failed" ? { message: s.message, offer: s.offer, onRetry } : undefined}
      stopped={s.status === "stopped"}
      canUndo={run.undo.added.length + run.undo.changed.length + run.undo.note.length > 0}
      undone={run.undone}
      onUndo={onUndo}
      onDelete={onDelete}
      onGoToCell={onGoToCell}
    />
  );
}















/** Now, updated every second while `on` (the elapsed time while it works). */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** The phone sheet's heights, as a share of the screen: half, full, and below which letting go closes it. */
const HALF = 0.55;
const FULL = 0.94;
const CLOSE_BELOW = 0.35;

/**
 * Dragging the sheet's handle (or its header, not its buttons) sizes it, as phone sheets do: it
 * follows the finger, then settles at the nearer of half and full height; let go low enough and it
 * closes. A tap switches half and full. Wider screens show a side panel, so none of this applies.
 */
function useSheetSize(onClose: () => void) {
  const [height, setHeight] = useState(FULL);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const dragged = useRef(false); // the click that ends a drag isn't a tap
  const settle = (h: number) => {
    if (h < CLOSE_BELOW) {
      onClose();
      setHeight(FULL);
    } else setHeight(Math.abs(h - HALF) < Math.abs(h - FULL) ? HALF : FULL);
  };
  const drag = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (window.matchMedia?.("(min-width: 640px)").matches) return;
      if ((e.target as HTMLElement).closest("button") && e.currentTarget.tagName !== "BUTTON") return; // the header's own buttons
      start.current = { y: e.clientY, h: height, moved: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s) return;
      const dy = e.clientY - s.y;
      if (!s.moved && Math.abs(dy) < 6) return; // a tap, not a drag
      s.moved = true;
      setDragging(true);
      setHeight(Math.min(0.97, Math.max(0.15, s.h - dy / window.innerHeight)));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      setDragging(false);
      if (!s?.moved) return;
      dragged.current = true;
      e.preventDefault();
      settle(s.h - (e.clientY - s.y) / window.innerHeight);
    },
    onPointerCancel: () => {
      start.current = null;
      setDragging(false);
      setHeight((h) => (Math.abs(h - HALF) < Math.abs(h - FULL) ? HALF : FULL));
    },
  };
  const toggle = () => {
    if (dragged.current) return void (dragged.current = false);
    setHeight((h) => (h < FULL ? FULL : HALF));
  };
  return { height, dragging, drag, toggle, set: setHeight };
}

/** Under the chat box: which model answers (change it right here, in Benchjot's own menu) and today's requests. */
function ChatModel({ used }: { used: number | null }) {
  const [model, setModel] = useAiModel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => void (ref.current?.contains(e.target as Node) || setOpen(false));
    const onKey = (e: KeyboardEvent) => void (e.key === "Escape" && setOpen(false));
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="flex items-center justify-center gap-1.5 px-2 pt-2 text-xs text-faint">
      <div ref={ref} className="relative">
        <ModelTrigger name={model ? AI_MODEL_NAMES[model] : ""} open={open} onClick={() => setOpen((o) => !o)} />
        {open && (
          <div role="menu" aria-label="Model" className="absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-bg p-1 text-left shadow-[0_8px_30px_rgb(0_0_0/0.35)]">
            {MODELS.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={m === model}
                onClick={() => {
                  setModel(m);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-tint"
              >
                <IconCheck className={cn("mt-0.5 size-3.5 shrink-0", m === model ? "text-fg" : "invisible")} />
                <span>
                  <span className="block text-sm text-fg">{AI_MODEL_NAMES[m]}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{WHAT[m]}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {used !== null && <span aria-live="polite">· {aiUsedText(used)}</span>}
    </div>
  );
}
