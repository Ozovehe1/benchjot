"use client";
import { serverOnlyImports } from "@/lib/run/python-imports";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAutosave } from "@/lib/ui/autosave";
import { cn } from "@/lib/ui/format";
import { clearServerRunResult, deleteCell, pendingServerRun, saveLastRun, updateCell } from "@/lib/data";
import { detectCellLanguage } from "@/lib/code/detect-language";
import { downloadName, isLanguageId, languageChosen, pickerLanguages, type LanguageId } from "@/lib/code/languages";
import type { Outcome } from "@/lib/notes/outcome";
import type { Cell } from "@/lib/notes/schemas";
import { codeHash, fromLastRun, toLastRun, type Chunk } from "@/lib/run/last-run";
import { runsOnServer } from "@/lib/run/server-languages";
import { MIME, runArchiveFiles, type CapturedOutputs } from "@/lib/run/outputs";
import { outputPagePath } from "@/lib/web/paths";
import { saveBlob, saveText } from "@/lib/files/save-file";
import { runsInBrowser, type RunHandle, type RunResult, type Stream } from "@/lib/run/types";
import { FixDiff } from "./fix-diff";
import { CELL_FRAME } from "../notes/note-parts";
import { copyText } from "@/lib/ui/copy";
import { ConnectPrompt, type ConnectKind } from "../account/connect-prompt";
import { FoldedCode } from "./folded-code";
import { RunOutput } from "../outputs/run-output";
import { RunOutputs } from "../outputs/run-outputs";
import { CellHeader } from "./cell-header";
import { Button, IconPlay, IconServer, IconStop, Notice, Spinner, TextButton } from "../ui";
import { userMessage } from "@/lib/ui/user-message";

const CodeEditor = dynamic(() => import("./code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="min-h-[72px]" />,
});

const MAX_OUTPUT = 200_000;

/** Object URLs for a run's outputs that aren't saved yet; revoked when they change. */
function useBlobUrls(live: CapturedOutputs | null): Record<string, string> {
  const urls = useMemo(() => {
    const out: Record<string, string> = {};
    if (!live) return out;
    for (const [name, data] of Object.entries(live.files)) {
      out[name] = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[name.slice(name.lastIndexOf(".") + 1)] }));
    }
    return out;
  }, [live]);
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

interface Props {
  cell: Cell;
  index: number;
  /** The note's, sent to Fix as context. */
  outcome?: Outcome | null;
  /** Shown directly above the cell ("Note before run"); the block knows nothing of what it is. */
  before?: React.ReactNode;
  /** Shown directly below the cell's run output ("Note after run"). */
  after?: React.ReactNode;
  /** Runs before the block is deleted (saves the cell notes still pending). */
  onBeforeRemove?: () => Promise<void>;
  /** Hands the page this cell's controls while it is shown (null once it's gone), for the voice agent. */
  onControls?: (id: string, controls: CellControls | null) => void;
}

/** What the voice agent can do to a cell, as the user could: change its code, run it, stop it. */
export interface CellControls {
  /** Replaces the code (as typing would) and saves it. */
  setCode: (code: string) => Promise<void>;
  /** Runs it in the browser (moving to the server by itself when it must), or on the server when asked; resolves with how it ended once the run is saved. Rejects when it can't run. */
  run: (where?: "device" | "server") => Promise<RunResult["outcome"]>;
  stop: () => void;
}


export function CellBlock({ cell, index, outcome = null, before, after, onBeforeRemove, onControls }: Props) {
  const initial: LanguageId = isLanguageId(cell.language) ? cell.language : "text";
  const [language, setLanguage] = useState<LanguageId>(initial);
  const [content, setContent] = useState(cell.content);
  // A language counts as chosen once the user picks it, or once the block was saved with code in it.
  const [chosen, setChosen] = useState(languageChosen(initial, cell.content));
  const [copied, setCopied] = useState(false);
  const [fixable, setFixable] = useState(0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  // Output shown under the block: the live run, or the saved latest run on open.
  const saved = cell.last_run ? fromLastRun(cell.last_run) : null;
  const [output, setOutput] = useState<Chunk[] | null>(saved?.chunks ?? null);
  const [result, setResult] = useState<RunResult | null>(saved?.result ?? null);
  const [ranHash, setRanHash] = useState<string | null>(cell.last_run?.code_hash ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fix, setFix] = useState<{ before: string; code: string; summary: string } | null>(null);
  const [fixing, setFixing] = useState(false);
  /** Why Fix couldn't answer (shown with Try again), apart from a fix it proposed. */
  const [fixError, setFixError] = useState<string | null>(null);
  /** The connection the user's last action called for and doesn't have (shown under the cell). */
  const [connect, setConnect] = useState<ConnectKind | null>(null);
  const handle = useRef<RunHandle | null>(null);
  // Figures, tables and charts: the live run's until it's saved, then the stored run's.
  const [live, setLive] = useState<CapturedOutputs | null>(null);
  const [hideSaved, setHideSaved] = useState(false);
  const savedOutputs = hideSaved ? null : (cell.last_run?.outputs ?? null);
  const latestSaved = useRef(cell.last_run?.outputs ?? null);
  latestSaved.current = cell.last_run?.outputs ?? null;
  const blobUrls = useBlobUrls(live);
  const store = useRef<typeof import("@/lib/run/output-store") | null>(null);
  const outputStore = async () => (store.current ??= await import("@/lib/run/output-store"));
  const [signed, setSigned] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!savedOutputs) return;
    let gone = false;
    outputStore()
      .then((m) => m.signOutputs(savedOutputs))
      .then((u) => !gone && setSigned(u))
      .catch((e: unknown) => !gone && setSaveError(userMessage(e, "load_figures")));
    return () => {
      gone = true;
    };
  }, [savedOutputs]);
  // The code and language as they are now, for a run started right after the agent set them.
  const now = useRef({ language, content });
  now.current = { language, content };
  const { flush } = useAutosave({ language, content }, (v) => updateCell(cell, v), {
    baseline: { language: initial, content: cell.content },
  });
  const runnable = runsInBrowser(language);
  const serverable = runsOnServer(language);
  const lastError = result?.outcome === "error" ? result.error?.text ?? "" : "";
  const hash = useMemo(() => codeHash(content), [content]);
  const stale = !running && output !== null && ranHash !== null && ranHash !== hash;

  /** Saves (or clears) the latest run; a failure shows under the output, the run itself still shows. */
  function persist(run: Parameters<typeof saveLastRun>[1]) {
    setSaveError(null);
    saveLastRun(cell, run).catch((e: unknown) => setSaveError(userMessage(e, "save_output")));
  }

  /** Uploads the run's outputs, saves the run, then deletes the run it replaced; true once the run is saved. */
  async function persistRun(chunks: Chunk[], r: RunResult, where: "browser" | "server", code: string): Promise<boolean> {
    setSaveError(null);
    const previous = latestSaved.current;
    let saved = null;
    if (r.outputs) {
      try {
        const [{ addStaticRenders }, m] = await Promise.all([import("@/lib/run/charts"), outputStore()]);
        saved = await m.uploadOutputs(cell.id, await addStaticRenders(r.outputs));
      } catch (e) {
        setSaveError(userMessage(e, "save_figures"));
      }
    }
    try {
      await saveLastRun(cell, toLastRun(chunks, r, where, code, new Date(), saved));
      setLive(null);
      setHideSaved(false);
      if (previous && previous.dir !== saved?.dir) void (await outputStore()).deleteOutputs(previous).catch(() => {});
      return true;
    } catch (e) {
      setSaveError(userMessage(e, "save_output"));
      if (saved) void (await outputStore()).deleteOutputs(saved).catch(() => {});
      return false;
    }
  }

  function clearOutput() {
    const previous = latestSaved.current;
    setOutput(null);
    setResult(null);
    setFix(null);
    setRanHash(null);
    setLive(null);
    persist(null);
    if (previous) void outputStore().then((m) => m.deleteOutputs(previous)).catch(() => {});
  }

  /** The whole run as a zip: output text, the error, and every figure, table and chart file. */
  async function downloadRun() {
    const text = { stdout: (output ?? []).filter((c) => c.stream === "stdout").map((c) => c.text).join(""), stderr: (output ?? []).filter((c) => c.stream === "stderr").map((c) => c.text).join(""), error: result?.error?.text ?? null };
    let outputs: CapturedOutputs | null = live;
    if (!outputs && savedOutputs) outputs = { manifest: savedOutputs, files: await (await outputStore()).fetchAllOutputs(savedOutputs) };
    const { zip } = await import("@/lib/files/zip");
    const base = downloadName(cell.filename, language, index).replace(/\.[^.]*$/, "");
    saveBlob(`${base}-run.zip`, new Blob([zip(runArchiveFiles(text, outputs)) as BlobPart], { type: "application/zip" }));
  }

  function edit(next: string) {
    setContent(next);
    if (!chosen) setLanguage(detectCellLanguage(next) ?? initial);
  }

  function pickLanguage(next: LanguageId) {
    setLanguage(next);
    setChosen(true);
    setFixable(0);
  }

  /** Runs in the browser or on the server (Python and R; a GPU when the code needs one); both report through RunOutput. */
  async function run(asked: "browser" | "server" = "browser"): Promise<RunResult["outcome"] | null> {
    const { language: lang, content: code } = now.current;
    // A Python cell importing a library only the server has (PyTorch, XGBoost, transformers, …) runs
    // there straight away, for Run, Run all and the Assistant alike: the same list on the phone.
    const serverLibs = lang === "python" && asked === "browser" && runsOnServer(lang) ? serverOnlyImports(code) : [];
    const where = serverLibs.length ? "server" : asked;
    const inBrowser = where === "browser" && runsInBrowser(lang);
    if (!inBrowser && !(where === "server" && runsOnServer(lang))) return null;
    const chunks: Chunk[] = [];
    let size = 0;
    const onOutput = (stream: Stream, text: string) => {
      if (size > MAX_OUTPUT) return;
      size += text.length;
      const chunk = { stream, text: size > MAX_OUTPUT ? text + "\n[output truncated]\n" : text };
      chunks.push(chunk);
      setOutput((o) => [...(o ?? []), chunk]);
    };
    setOutput([]);
    setLive(null);
    setHideSaved(true);
    setRanHash(codeHash(code));
    setResult(null);
    setFix(null);
    setRunning(true);
    if (serverLibs.length) onOutput("stderr", `This code uses ${serverLibs.slice(0, 3).join(", ")}, which ${serverLibs.length === 1 ? "runs" : "run"} on the server, so it's running there.\n`);
    const h = inBrowser ? (await import("@/lib/run/runner")).runCode(lang as "python" | "r", code, { onStatus: setStatus, onOutput }) : await serverRun(lang, code, onOutput);
    handle.current = h;
    let r = await h.done;
    handle.current = null;
    let ranOn: "browser" | "server" = inBrowser ? "browser" : "server";
    // Code the browser can't run (TensorFlow, PyTorch, an R package with no browser build): Run goes
    // on to the server by itself, with a GPU when the code needs one.
    if (r.needsServer && inBrowser && runsOnServer(lang)) {
      onOutput("stderr", "This code needs libraries that don't run in the browser, so it's running on the server.\n");
      const s = await serverRun(lang, code, onOutput);
      handle.current = s;
      r = await s.done;
      handle.current = null;
      ranOn = "server";
    }
    await finish(chunks, r, ranOn, code);
    return r.outcome;
  }

  /** A server run: Python in the background (it may outlast the page, up to an hour); R waits for its result. */
  async function serverRun(lang: string, code: string, onOutput: (stream: Stream, text: string) => void): Promise<RunHandle> {
    const client = await import("@/lib/run/server-client");
    return lang === "python" ? client.startBackgroundRun(lang, code, cell.id, onOutput, setStatus) : client.runOnServer(lang, code, onOutput, setStatus);
  }

  /** Shows a finished run and saves it as the cell's last run; a background run's stored result is cleared once saved. */
  async function finish(chunks: Chunk[], r: RunResult, ranOn: "browser" | "server", code: string): Promise<void> {
    setStatus("");
    setResult(r);
    setRunning(false);
    if (r.outputs) setLive(r.outputs);
    const saved = await persistRun(chunks, r, ranOn, code);
    if (saved && r.serverRunId) void clearServerRunResult(r.serverRunId).catch(() => {});
  }

  // The agent's way in: the same edit and run the user's taps make, through the latest render's functions.
  const latest = useRef({ edit, run, flush });
  latest.current = { edit, run, flush };
  useEffect(() => {
    if (!onControls) return;
    onControls(cell.id, {
      setCode: async (code) => {
        latest.current.edit(code);
        now.current = { ...now.current, content: code };
        await updateCell(cell, { content: code });
      },
      run: async (where) => {
        if (handle.current) throw new Error("it is already running");
        const lang = now.current.language;
        if (!runsInBrowser(lang) && !runsOnServer(lang)) throw new Error(`${lang === "text" ? "plain text" : "this language"} doesn't run`);
        const onServer = (where === "server" && runsOnServer(lang)) || !runsInBrowser(lang);
        return (await latest.current.run(onServer ? "server" : "browser")) ?? "stopped";
      },
      stop: () => handle.current?.stop(),
    });
    return () => onControls(cell.id, null);
    // The controls read the latest render through refs; registered once per cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.id, onControls]);

  // A background run of this cell still going, or finished while no page showed it: follow it / show it.
  useEffect(() => {
    let gone = false;
    void pendingServerRun(cell.id).then(async (run) => {
      if (gone || !run || handle.current) return;
      const chunks: Chunk[] = [];
      const onOutput = (stream: Stream, text: string) => {
        const chunk = { stream, text };
        chunks.push(chunk);
        setOutput((o) => [...(o ?? []), chunk]);
      };
      setOutput([]);
      setLive(null);
      setHideSaved(true);
      setResult(null);
      setRanHash(codeHash(cell.content));
      setRunning(true);
      const h = (await import("@/lib/run/server-client")).followBackgroundRun(run, onOutput, setStatus);
      handle.current = h;
      const r = await h.done;
      handle.current = null;
      if (!gone) void finish(chunks, r, "server", cell.content);
    });
    return () => {
      gone = true;
    };
    // Once per cell: a later run of it is followed by run() itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.id]);

  async function proposeFix() {
    setFixing(true);
    setFixError(null);
    try {
      const { requestFix } = await import("@/lib/run/server-client");
      const answer = await requestFix(language, content, lastError, outcome);
      setFix({ before: content, code: answer.code, summary: answer.summary });
    } catch (e) {
      if ((e as { offer?: unknown } | null)?.offer === "own_key") setConnect("ai");
      else setFixError(userMessage(e, "fix"));
    } finally {
      setFixing(false);
    }
  }

  function acceptFix() {
    if (!fix) return;
    setContent(fix.code);
    setFix(null);
  }

  async function autofix() {
    const { ruffFixAll } = await import("@/lib/run/ruff");
    setContent(await ruffFixAll(content));
  }

  async function copy() {
    // A refused clipboard leaves the label as it is: nothing was copied.
    if (!(await copyText(content))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function remove() {
    if (content.trim() && !window.confirm("Remove this code?")) return;
    handle.current?.stop();
    await flush();
    await onBeforeRemove?.();
    const previous = latestSaved.current;
    await deleteCell(cell);
    if (previous) void outputStore().then((m) => m.deleteOutputs(previous)).catch(() => {});
  }

  // At a glance, on the cell's edge: running, how its last run ended, or that the code changed since.
  const ended = result?.outcome ?? (hideSaved ? null : cell.last_run?.outcome) ?? null;
  const edge = running ? "running" : stale ? "stale" : ended === "ok" ? "ok" : ended === "error" || ended === "timeout" ? "failed" : null;

  return (
    <div id={`cell-${cell.id}`} className={cn(CELL_FRAME, "relative scroll-mt-24")}>
      {edge && (
        <span
          aria-hidden
          className={cn(
            "absolute top-5 bottom-5 left-0 w-[3px] rounded-r-full",
            edge === "ok" && "bg-ok/70",
            edge === "failed" && "bg-fail",
            edge === "running" && "animate-pulse bg-fg/60",
            edge === "stale" && "border-l-[3px] border-dashed border-faint bg-transparent",
          )}
        />
      )}
      {before}
      <CellHeader
        filename={cell.filename}
        language={
          <select
            value={language}
            onChange={(e) => pickLanguage(e.target.value as LanguageId)}
            aria-label={`Language of code ${index + 1}`}
            className="-ml-1 min-h-12 shrink-0 cursor-pointer appearance-none bg-transparent px-1 outline-none hover:text-fg"
          >
            {pickerLanguages(language).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        }
        actions={
          running ? (
            <Button onClick={() => handle.current?.stop()} variant="neutral" size="sm">
              <IconStop className="size-4" />
              Stop
            </Button>
          ) : (
            <div className="flex items-center gap-4">
              {serverable && (
                <TextButton onClick={() => run("server")} strong={!runnable}>
                  <IconServer className="size-4" />
                  Run on server
                </TextButton>
              )}
              {runnable && (
                <Button onClick={() => run("browser")} size="sm" className="pl-3">
                  <IconPlay className="size-4" />
                  Run
                </Button>
              )}
            </div>
          )
        }
      />

      <FoldedCode code={content}>
      <CodeEditor
        value={content}
        onChange={edit}
        language={language}
        label={`Code ${index + 1}`}
        errorLine={stale ? null : result?.error?.line ?? null}
        onFixable={setFixable}
        onRun={() => {
          if (!handle.current && (runnable || serverable)) void run(runnable ? "browser" : "server");
        }}
      />
      </FoldedCode>

      {/* The code's own actions sit right under the code, named for what they act on (the output has its own Copy). */}
      <div className="flex flex-wrap gap-x-5">
        <TextButton onClick={copy} disabled={content === ""}>
          {copied ? "Copied" : "Copy code"}
        </TextButton>
        <TextButton onClick={() => saveText(downloadName(cell.filename, language, index), content)} disabled={content === ""}>
          Download code
        </TextButton>
        {language === "python" && fixable > 0 && (
          <TextButton onClick={autofix} aria-label={`Tidy: apply ${fixable} linter ${fixable === 1 ? "fix" : "fixes"}`}>
            Tidy ({fixable})
          </TextButton>
        )}
      </div>

      {output && (
        <RunOutput
          chunks={output}
          status={status}
          running={running}
          result={result}
          stale={stale}
          note={saveError}
          onClear={clearOutput}
          onDownload={live || savedOutputs ? downloadRun : undefined}
        />
      )}

      {live ? (
        <RunOutputs manifest={live.manifest} urls={blobUrls} hrefs={null} />
      ) : savedOutputs ? (
        <RunOutputs
          manifest={savedOutputs}
          urls={signed}
          hrefs={savedOutputs.items.map((_, i) => outputPagePath(cell.note_id, cell.id, i))}
        />
      ) : null}

      {after}

      {connect && <ConnectPrompt kind={connect} onDismiss={() => setConnect(null)} />}

      {fix && <FixDiff before={fix.before} after={fix.code} summary={fix.summary} onAccept={acceptFix} onReject={() => setFix(null)} />}
      {fixError && !fixing && (
        <Notice className="my-2" actions={[{ label: "Try again", onClick: () => void proposeFix() }]} onDismiss={() => setFixError(null)}>
          {fixError}
        </Notice>
      )}

      <div className="flex gap-5 pb-1">
        {lastError && !running && !fix && !fixError && (
          <TextButton onClick={proposeFix} disabled={fixing} aria-busy={fixing || undefined}>
            {fixing && <Spinner className="size-3.5" />}
            {fixing ? "Suggesting a fix…" : "Suggest a fix"}
          </TextButton>
        )}
        <TextButton onClick={remove} className="ml-auto">
          Remove
        </TextButton>
      </div>
    </div>
  );
}
