"use client";
// The Assistant's pieces as the panel draws them: the user's message, the plan, what it did in the note,
// its narration and answer, the action buttons and the composer. Presentational only (no data access),
// so the landing's showcase renders the very same components as the app (components/app/showcase.tsx).
import { useEffect, useState } from "react";
import type { ActionDetail, AgentAction, AgentPlan, NoteProposal } from "@/lib/ai/agent";
import { diffHunks, lineDiff } from "@/lib/ai/fix";
import { ASSISTANT_LIMITS } from "@/lib/ai/assistant";
import { copyText } from "@/lib/ui/copy";
import { cn } from "@/lib/ui/format";
import { StaticCode } from "../code/static-code";
import { IconCheck, IconChevron, IconCopy, IconMic, IconSend, IconStop, IconTrash, IconUndo, IconX, Notice, Spinner } from "../ui";
import { Markdown } from "../ui/markdown";
import { useApplyProposal } from "./proposal-context";

/** 41 s, or 7 min 16 s. */
export const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

export function UserMessage({ text, voice }: { text: string; voice: boolean }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-tint px-3.5 py-2 text-[15px] leading-relaxed text-fg">
        {voice && <IconMic aria-label="Spoken" className="-mt-0.5 mr-1.5 inline size-3.5 text-faint" />}
        {text}
      </p>
    </div>
  );
}

/** Each thing done in the note: ✓ ran cleanly, ✗ failed, • the rest. Each opens to show what it was: the code, the change, what the run gave, the text. */
export function ActivityList({ actions, onGoToCell }: { actions: readonly AgentAction[]; onGoToCell: (id: string) => void }) {
  if (!actions.length) return null;
  return (
    <ul aria-label="Done in the note" className="space-y-0.5">
      {actions.map((a, i) => (
        <li key={i}>
          <ActivityRow action={a} onGoToCell={onGoToCell} />
        </li>
      ))}
    </ul>
  );
}

export function ActivityRow({ action: a, onGoToCell }: { action: AgentAction; onGoToCell: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const mark = a.tone === "ok" ? <IconCheck className="size-3.5 text-ok" /> : a.tone === "fail" ? <IconX className="size-3.5 text-fail" /> : <span className="size-1.5 rounded-full bg-faint" />;
  const line = (
    <>
      <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">{mark}</span>
      <span className="min-w-0 flex-1 truncate">{a.text}</span>
      {a.detail && a.detail.kind !== "proposal" && <IconChevron aria-hidden className={cn("size-3 shrink-0 text-faint transition-transform", open && "rotate-90")} />}
    </>
  );
  const rowClass = "flex min-h-8 w-full items-center gap-2 rounded-md px-1 text-left font-mono text-xs text-muted";
  return (
    <div>
      {(a.detail && a.detail.kind !== "proposal") || a.cellId ? (
        <button type="button" aria-expanded={a.detail ? open : undefined} onClick={() => (a.detail ? setOpen((o) => !o) : onGoToCell(a.cellId!))} className={cn(rowClass, "transition-colors hover:bg-tint hover:text-fg")}>
          {line}
        </button>
      ) : (
        <div className={rowClass}>{line}</div>
      )}
      {a.detail?.kind === "proposal" && <ProposalCard proposal={a.detail} />}
      {open && a.detail && a.detail.kind !== "proposal" && (
        <div className="mb-2 ml-6 mt-1 space-y-1.5">
          <DetailView detail={a.detail} />
          {a.cellId && (
            <button type="button" onClick={() => onGoToCell(a.cellId!)} className="text-xs text-muted underline underline-offset-4 transition-colors hover:text-fg">
              Go to the cell
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A change proposed to another note: what would be added and where, with Apply. Nothing changes there
 * until the user taps it; a second tap (or a reload) never adds it twice.
 */
export function ProposalCard({ proposal }: { proposal: NoteProposal }) {
  const apply = useApplyProposal();
  const [state, setState] = useState<"idle" | "working" | "applied" | "already" | "failed">("idle");
  const where = proposal.after ? `under “${proposal.after}”` : "at the end";
  const done = state === "applied" || state === "already";
  return (
    <div className="mb-2 ml-6 mt-1 space-y-2 rounded-lg border border-line bg-raise px-3 py-2.5">
      <p className="text-xs text-muted">
        Proposed for <span className="text-fg">{proposal.title}</span>, {where}:
      </p>
      <div className="max-h-[220px] overflow-auto text-sm">
        <Markdown>{proposal.text}</Markdown>
      </div>
      {apply && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={state === "working" || done}
            onClick={async () => {
              setState("working");
              try {
                setState(await apply(proposal));
              } catch {
                setState("failed");
              }
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-medium text-fg transition-colors hover:bg-tint disabled:opacity-60"
          >
            {state === "working" ? <span className="breathe size-2 rounded-full bg-fg" /> : done ? <IconCheck className="size-3.5 text-ok" /> : null}
            {done ? (state === "already" ? "Already in that note" : "Applied") : `Apply to ${proposal.title}`}
          </button>
          {state === "failed" && (
            <span role="alert" className="inline-flex items-center gap-1 text-xs text-fg">
              <IconX className="size-3.5 text-fail" />
              It couldn’t be applied. Try again.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A thing done, opened: the code it added, the change it made (a line diff), what a run gave, or the text it wrote. */
export function DetailView({ detail }: { detail: Exclude<ActionDetail, { kind: "proposal" }> }) {
  const box = "max-h-[300px] overflow-auto rounded-lg border border-line bg-raise";
  if (detail.kind === "code") return <div className={cn(box, "px-3")}><StaticCode code={detail.code} language={detail.language} label="Code it added" /></div>;
  if (detail.kind === "text") return <div className={cn(box, "px-3 py-2 text-sm")}><Markdown>{detail.text}</Markdown></div>;
  if (detail.kind === "output") return <pre className={cn(box, "whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed text-fg")}>{detail.text}</pre>;
  const hunks = diffHunks(lineDiff(detail.before, detail.after));
  return (
    <pre aria-label="What it changed" className={cn(box, "py-1.5 font-mono text-xs leading-relaxed")}>
      {hunks.length === 0 && <div className="px-3 text-muted">No change.</div>}
      {hunks.map((h, i) =>
        h === null ? (
          <div key={i} className="px-3 text-faint">⋯</div>
        ) : (
          <div key={i} className={cn("flex px-2", h.kind === "add" && "bg-tint text-fg", h.kind === "del" && "text-muted line-through decoration-faint", h.kind === "same" && "text-faint")}>
            <span aria-hidden className="w-4 shrink-0 select-none">{h.kind === "add" ? "+" : h.kind === "del" ? "−" : " "}</span>
            <span className="whitespace-pre-wrap break-words">{h.text || " "}</span>
          </div>
        ),
      )}
    </pre>
  );
}

/** The plan as a checklist: finished steps ticked, the one it's on turning (while it works), the rest waiting. */
export function PlanList({ plan, working = false }: { plan: AgentPlan; working?: boolean }) {
  return (
    <ol aria-label="Plan" className="space-y-1">
      {plan.steps.map((step, i) => {
        const done = i < plan.done;
        const now = working && i === plan.done;
        return (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span aria-hidden className="mt-[3px] flex size-4 shrink-0 items-center justify-center">
              {done ? <IconCheck className="size-3.5 text-ok" /> : now ? <span className="breathe size-2.5 rounded-full bg-fg" /> : <span className="size-3 rounded-full border border-faint" />}
            </span>
            <span className={cn("leading-relaxed", done ? "text-muted" : now ? "shimmer-text" : "text-muted")}>
              <span className="sr-only">{done ? "Done: " : now ? "Doing: " : "To do: "}</span>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** What it says while it works (its plan, what it's doing): Markdown, quieter than the answer. */
export function Narration({ text }: { text: string }) {
  return (
    <div className="break-words text-sm leading-relaxed text-muted [&_.prose-notes]:text-muted">
      <Markdown>{text}</Markdown>
    </div>
  );
}

export function Reply({ text }: { text: string }) {
  return (
    <div className="break-words text-[15px] leading-relaxed text-fg">
      <Markdown>{text}</Markdown>
    </div>
  );
}

export function Actions({ children }: { children: React.ReactNode }) {
  return <div className="-ml-2 flex items-center gap-0.5 text-muted">{children}</div>;
}

export function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-tint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40 disabled:pointer-events-none disabled:opacity-40">
      {children}
    </button>
  );
}

export function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconAction label={copied ? "Copied" : "Copy"} onClick={() => void copyText(text).then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
      {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
    </IconAction>
  );
}

export function RoundButton({ label, onClick, disabled, tone = "primary", children }: { label: string; onClick: () => void; disabled?: boolean; tone?: "primary" | "neutral"; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,transform,opacity] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40 disabled:opacity-30",
        tone === "primary" ? "bg-fg text-bg" : "bg-tint text-fg hover:bg-line",
      )}
    >
      {children}
    </button>
  );
}

/** The box: grows with what you write; Enter sends (Shift+Enter for a new line; on a phone, the button); the microphone; one round button that sends, or stops. */
export function Composer({ field, value, listening, onChange, onSend, working, onStop, mic }: {
  field: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  listening: number | null;
  onChange: (v: string) => void;
  onSend: () => void;
  working: boolean;
  onStop: () => void;
  mic: { start: () => void; finish: () => void; cancel: () => void } | null;
}) {
  useEffect(() => {
    const el = field.current;
    if (!el || !el.scrollHeight) return; // hidden: measured when it shows
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  });
  const fine = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;
  return (
    <div className="rounded-[22px] border border-line bg-raise transition-[border-color] focus-within:border-faint">
      <textarea
        ref={field}
        value={value}
        readOnly={listening !== null}
        onChange={(e) => onChange(e.target.value.slice(0, ASSISTANT_LIMITS.maxRequestChars))}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          if (e.metaKey || e.ctrlKey || (fine && !e.shiftKey)) {
            e.preventDefault();
            if (!working) onSend();
          }
        }}
        rows={1}
        placeholder={listening !== null ? "Listening…" : "Ask, or say what to do"}
        aria-label="Ask, or say what to do"
        className="block max-h-[200px] min-h-12 w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-relaxed text-fg outline-none placeholder:text-faint"
      />
      <div className="flex items-center justify-end gap-1 px-2 pb-2 pt-1">
        {mic && listening === null && (
          <IconAction label="Speak" onClick={mic.start} disabled={working}>
            <IconMic className="size-[18px]" />
          </IconAction>
        )}
        {mic && listening !== null && (
          <>
            <IconAction label="Cancel" onClick={mic.cancel}>
              <IconX className="size-4" />
            </IconAction>
            <span className="flex items-center gap-2 font-mono text-xs text-muted">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-fail" />
              {Math.floor(listening / 60)}:{String(listening % 60).padStart(2, "0")}
            </span>
          </>
        )}
        {listening !== null && mic ? (
          <RoundButton label="Done: send what was heard" onClick={mic.finish}>
            <IconCheck className="size-4" />
          </RoundButton>
        ) : working ? (
          <RoundButton label="Stop" onClick={onStop} tone="neutral">
            <IconStop className="size-3.5" />
          </RoundButton>
        ) : (
          <RoundButton label="Send" onClick={onSend} disabled={!value.trim()}>
            <IconSend className="size-4" />
          </RoundButton>
        )}
      </div>
    </div>
  );
}

/** "Worked 41 s · ran 2 cells · wrote in the note". */
export function workedLine(secs: number, actions: readonly AgentAction[]): string {
  const ran = actions.filter((a) => a.text.startsWith("Ran cell")).length;
  const failed = actions.filter((a) => a.tone === "fail").length;
  const wrote = actions.some((a) => a.text.startsWith("Wrote in the note") || a.text.includes("note’s text") || a.text.startsWith("Removed text"));
  const parts = [`Worked ${duration(secs)}`];
  if (ran) parts.push(`ran ${ran} cell${ran === 1 ? "" : "s"}`);
  if (wrote) parts.push("wrote in the note");
  if (failed) parts.push(`${failed} failed on the way`);
  return parts.join(" · ");
}

/** What it's doing right now, while it works: a breathing dot, the step in words, and the time so far. */
export function WorkingLine({ doing, secs }: { doing: string; secs: number }) {
  return (
    <div role="status" className="flex items-center gap-2.5 text-sm">
      <span aria-hidden className="breathe size-2 shrink-0 rounded-full bg-fg" />
      <span className="shimmer-text min-w-0 truncate">{doing}</span>
      <span className="ml-auto shrink-0 font-mono text-xs text-faint">{duration(secs)}</span>
    </div>
  );
}

/** The model under the chat box: its name and a chevron; a tap opens the menu. */
export function ModelTrigger({ name, open, onClick }: { name: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Model: ${name}`} onClick={onClick} className={cn("inline-flex min-h-8 items-center gap-1 rounded-md px-2 transition-colors hover:bg-tint hover:text-fg", open && "bg-tint text-fg")}>
      {name}
      <IconChevron className={cn("size-3 transition-transform", open ? "-rotate-90" : "rotate-90")} />
    </button>
  );
}

/** A finished request: the steps folded into one line, the answer, then Copy, Undo and Delete. */
export function Finished({ secs, narration, actions, plan, answer, failed, stopped, canUndo, undone, onUndo, onDelete, onGoToCell }: {
  secs: number;
  narration: readonly string[];
  actions: readonly AgentAction[];
  plan?: AgentPlan;
  answer: string;
  failed?: { message: string; offer?: string; onRetry?: () => void };
  stopped?: boolean;
  canUndo: boolean;
  undone?: "working" | "done" | "failed";
  onUndo: () => void;
  onDelete: () => void;
  onGoToCell: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {(actions.length > 0 || narration.length > 0) && (
        <details className="group">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm text-muted transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
            <IconChevron className="size-3.5 transition-transform group-open:rotate-90" />
            {workedLine(secs, actions)}
          </summary>
          <div className="mt-2 space-y-3 border-l border-line pl-3">
            {plan && <PlanList plan={plan} />}
            {narration.map((m, i) => (
              <Narration key={i} text={m} />
            ))}
            <ActivityList actions={actions} onGoToCell={onGoToCell} />
          </div>
        </details>
      )}
      {answer && <Reply text={answer} />}
      {failed && (
        <>
          <Notice actions={failed.onRetry ? [{ label: "Try again", onClick: failed.onRetry }] : []}>{failed.message}</Notice>
        </>
      )}
      {stopped && <p className="text-sm text-muted">Stopped.</p>}
      <Actions>
        {answer && <CopyAction text={answer} />}
        {canUndo && undone !== "done" && (
          <IconAction label={undone === "failed" ? "Undo didn’t finish. Try again" : "Undo everything it changed"} onClick={onUndo} disabled={undone === "working"}>
            {undone === "working" ? <Spinner /> : <IconUndo className="size-4" />}
          </IconAction>
        )}
        {undone === "done" && <span className="px-2 text-xs text-faint">Undone</span>}
        <IconAction label="Delete" onClick={onDelete}><IconTrash className="size-4" /></IconAction>
      </Actions>
    </div>
  );
}
