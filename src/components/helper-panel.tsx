"use client";
// The note Helper, online (Android: ui/Helper.kt, the same controls and words). Opened from the
// note's top bar: write code for the note, or ask it a question. The note is read only on the tap that
// sends. Code goes into the note only when you tap "Insert into note", as a new code cell; it never
// runs by itself, and the helper never writes the note's text, cell notes or outcome. Each answered
// turn is saved with the note and shown again when the Helper reopens (here and on Android); older
// turns are condensed by the database into the note's summary, shown first. Clear deletes them.
import { useEffect, useReducer, useRef, useState } from "react";
import { cn } from "@/lib/format";
import { deleteHelperSummary, deleteHelperTurn, loadHelperHistory, saveHelperTurn } from "@/lib/data";
import {
  answeredTurns,
  HELPER_HISTORY,
  HELPER_LIMITS,
  HELPER_PLACEHOLDER,
  HELPER_SUGGESTIONS,
  HELPER_TASK_CHOICES,
  helperCell,
  helperHistory,
  helperLanguage,
  helperTurns,
  historySize,
  isWorking,
  noteContext,
  type HelperAnswer,
  type HelperCell,
  type HelperTask,
  type HelperTurn,
  type TurnAction,
} from "@/lib/helper";
import type { SnippetInput } from "@/lib/schemas";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { userMessage } from "@/lib/user-message";
import { StaticCode } from "./static-code";
import { Button, Segmented, TextButton } from "./ui";

/** The note as it is right now, read only when asked. */
export interface HelperNote {
  title: string;
  body: string;
  cells: HelperCell[];
}

interface Props {
  /** The note whose helper history this is. */
  entryId: string;
  open: boolean;
  onClose: () => void;
  /** Reads the note (saving pending edits first); called only by a send. */
  readNote: () => Promise<HelperNote>;
  /** Adds a new code cell at the end of the note; the panel's only way to change the note. */
  onInsert: (cell: SnippetInput) => void;
}

export function HelperPanel({ entryId, open, onClose, readNote, onInsert }: Props) {
  const [task, setTask] = useState<HelperTask>("write");
  const [input, setInput] = useState("");
  const [turns, dispatch] = useReducer(helperTurns, [] as HelperTurn[]);
  const working = isWorking(turns);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const inset = useKeyboardInset();
  const [summary, setSummary] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Closing the panel stops a request in flight (as closing Android's sheet stops the model).
  useEffect(() => {
    if (open) field.current?.focus();
    else stopRequest(abort, dispatch);
  }, [open]);

  // Each open reads the note's saved turns and summary again (they may have changed on the phone).
  useEffect(() => {
    if (!open) return;
    let live = true;
    setNotice(null);
    loadHelperHistory(entryId).then(
      (h) => {
        if (!live) return;
        setSummary(h.summary);
        dispatch({ type: "load", turns: h.turns, firstId: nextId.current });
        nextId.current += h.turns.length;
      },
      (e: unknown) => live && setNotice(userMessage(e, "history_load")),
    );
    return () => {
      live = false;
    };
  }, [open, entryId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  async function send(text: string, kind: HelperTask) {
    const request = text.trim().slice(0, HELPER_LIMITS.maxRequestChars);
    if (!request || working) return;
    const id = nextId.current++;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setTask(kind);
    setInput("");
    dispatch({ type: "send", id, task: kind, request });
    try {
      const note = await readNote(); // read now, on this tap only
      const history = helperHistory(summary, answeredTurns(turns));
      const { requestHelper } = await import("@/lib/run/server-client");
      const body = { task: kind, request, language: helperLanguage(note.cells), title: note.title, note: noteContext(note.body, note.cells, HELPER_LIMITS.maxContextChars - historySize(history)).text, history };
      const answer = await requestHelper(body, ctrl.signal);
      if (ctrl.signal.aborted) return;
      dispatch({ type: "settle", id, state: { status: "done", answer } });
      saveHelperTurn(entryId, { task: kind, request, answer }).then(
        (savedId) => dispatch({ type: "saved", id, savedId }),
        (e: unknown) => setNotice(userMessage(e, "history_save")),
      );
    } catch (e) {
      if (!ctrl.signal.aborted) dispatch({ type: "settle", id, state: { status: "failed", message: userMessage(e, "helper") } });
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
  }

  /** Clear: the turn goes from the panel, and from the history when it was saved. */
  function clear(turn: HelperTurn) {
    setNotice(null);
    if (!turn.savedId) return dispatch({ type: "remove", id: turn.id });
    deleteHelperTurn(turn.savedId).then(
      () => dispatch({ type: "remove", id: turn.id }),
      (e: unknown) => setNotice(userMessage(e, "history_clear")),
    );
  }

  function clearSummary() {
    setNotice(null);
    deleteHelperSummary(entryId).then(
      () => setSummary(""),
      (e: unknown) => setNotice(userMessage(e, "history_clear")),
    );
  }

  function retry(turn: HelperTurn) {
    dispatch({ type: "remove", id: turn.id });
    void send(turn.request, turn.task);
  }

  return (
    <div hidden={!open} className="fixed inset-0 z-40">
      <div aria-hidden className="absolute inset-0 bg-bg/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="helper-title"
        style={{ bottom: inset }}
        className="absolute inset-x-0 flex max-h-[88dvh] flex-col rounded-t-xl border-t border-line bg-bg px-5 pb-[max(env(safe-area-inset-bottom),12px)] shadow-lg sm:inset-x-auto sm:right-0 sm:top-0 sm:max-h-none sm:w-[420px] sm:rounded-none sm:border-l sm:border-t-0"
      >
        <header className="flex min-h-14 items-center gap-3">
          <h2 id="helper-title" className="flex-1 text-xl text-fg">Helper</h2>
          <span className="text-xs text-faint">Online helper</span>
          <TextButton onClick={onClose} strong className="min-w-12 justify-center">Close</TextButton>
        </header>

        <Segmented label="What the helper does" options={HELPER_TASK_CHOICES} value={task} onChange={setTask} />

        <div ref={log} aria-live="polite" className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5">
          {summary && (
            <section aria-label="Earlier turns" className="border-b border-line py-4">
              <h3 className="text-xs text-faint">Earlier, condensed after {HELPER_HISTORY.days} days</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{summary}</p>
              <TextButton onClick={clearSummary}>Clear</TextButton>
            </section>
          )}
          {turns.map((t) => (
            <Turn key={t.id} turn={t} onInsert={(a) => { onInsert(helperCell(a)); onClose(); }} onRemove={() => clear(t)} onRetry={() => retry(t)} />
          ))}
        </div>
        {notice && <p role="alert" className="pt-2 text-sm text-fg">{notice}</p>}

        <div className="pt-2">
          <textarea
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, HELPER_LIMITS.maxRequestChars))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send(input, task);
              }
            }}
            rows={2}
            placeholder={HELPER_PLACEHOLDER[task]}
            aria-label={HELPER_PLACEHOLDER[task]}
            className="block max-h-40 min-h-12 w-full resize-none border-b border-line bg-transparent py-3 text-[15px] text-fg outline-none placeholder:text-faint"
          />
          {!input.trim() && turns.length === 0 && !summary && (
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pt-3 [scrollbar-width:none]">
              {HELPER_SUGGESTIONS.map(([label, kind]) => (
                <button key={label} type="button" onClick={() => void send(label, kind)} className="min-h-12 shrink-0 rounded-full border border-line px-4 text-sm text-fg hover:bg-tint">
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-5 pt-3">
            {working ? (
              <Button variant="neutral" onClick={() => stopRequest(abort, dispatch)}>Stop</Button>
            ) : (
              <Button onClick={() => void send(input, task)} disabled={!input.trim()}>Send</Button>
            )}
          </div>
          <p className="pt-3 text-xs text-faint">Reads this note only when you send. Code is added only when you tap Insert, and runs only when you tap Run. Turns are saved with this note for {HELPER_HISTORY.days} days, then kept as a short summary. Clear deletes them.</p>
        </div>
      </div>
    </div>
  );
}

/** Stops the request in flight; its turn is dropped and a late answer ignored. */
function stopRequest(abort: React.RefObject<AbortController | null>, dispatch: React.Dispatch<TurnAction>) {
  abort.current?.abort();
  abort.current = null;
  dispatch({ type: "stop" });
}

function Turn({ turn, onInsert, onRemove, onRetry }: { turn: HelperTurn; onInsert: (a: Extract<HelperAnswer, { kind: "code" }>) => void; onRemove: () => void; onRetry: () => void }) {
  const s = turn.state;
  return (
    <article aria-label={turn.task === "write" ? "Write code" : "Ask this note"} className="border-b border-line py-4 last:border-b-0">
      <p className="ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-tint px-3 py-2 text-sm text-fg">{turn.request}</p>
      <div className="mt-3 space-y-3">
        {s.status === "working" && (
          <>
            <div className="h-0.5 overflow-hidden bg-line"><div className="h-full w-1/3 animate-pulse bg-muted" /></div>
            <p role="status" className="text-sm text-muted">Thinking…</p>
          </>
        )}
        {s.status === "failed" && (
          <>
            <p role="alert" className="text-sm text-fg">{s.message}</p>
            <div className="flex items-center gap-5">
              <Button onClick={onRetry}>Try again</Button>
              <TextButton onClick={onRemove}>Clear</TextButton>
            </div>
          </>
        )}
        {s.status === "done" && s.answer.kind === "code" && <CodeAnswer answer={s.answer} onInsert={onInsert} onClear={onRemove} />}
        {s.status === "done" && s.answer.kind === "prose" && (
          <>
            <p className="whitespace-pre-wrap break-words text-[15px] text-fg">{s.answer.text}</p>
            <div className="flex items-center gap-5">
              <CopyButton text={s.answer.text} />
              <TextButton onClick={onRemove}>Clear</TextButton>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function CodeAnswer({ answer, onInsert, onClear }: { answer: Extract<HelperAnswer, { kind: "code" }>; onInsert: (a: Extract<HelperAnswer, { kind: "code" }>) => void; onClear: () => void }) {
  return (
    <>
      <div className="max-h-[360px] overflow-auto rounded-md border border-line px-3">
        <StaticCode code={answer.code} language={answer.language} label="Code the helper wrote" />
      </div>
      {answer.summary && <p className="text-sm text-muted">{answer.summary}</p>}
      <div className="flex flex-wrap items-center gap-x-5">
        <Button onClick={() => onInsert(answer)}>Insert into note</Button>
        <CopyButton text={answer.code} />
        <TextButton onClick={onClear}>Clear</TextButton>
      </div>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <TextButton
      className={cn(copied && "text-fg")}
      onClick={() => {
        // A refused clipboard leaves the label as "Copy": nothing was copied.
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, () => setCopied(false));
      }}
    >
      {copied ? "Copied" : "Copy"}
    </TextButton>
  );
}
