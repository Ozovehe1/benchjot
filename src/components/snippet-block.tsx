"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAutosave } from "@/lib/autosave";
import { deleteSnippet, saveLastRun, updateSnippet, usePlan } from "@/lib/data";
import { detectLanguage } from "@/lib/detect-language";
import { downloadName, isLanguageId, languageChosen, LANGUAGES, type LanguageId } from "@/lib/languages";
import type { Outcome } from "@/lib/outcome";
import type { Snippet } from "@/lib/schemas";
import { codeHash, fromLastRun, toLastRun, type Chunk } from "@/lib/run/last-run";
import { runsOnServer } from "@/lib/run/server-languages";
import { MIME, runArchiveEntries, type CapturedOutputs } from "@/lib/run/outputs";
import { outputPagePath } from "@/lib/paths";
import { saveBlob, saveText } from "@/lib/save-file";
import { runsInBrowser, type RunHandle, type RunResult, type Stream } from "@/lib/run/types";
import { FixDiff } from "./fix-diff";
import { RunOutput } from "./run-output";
import { RunOutputs } from "./run-outputs";
import { SnippetHeader } from "./snippet-header";
import { Button, TextButton } from "./ui";

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

/** `outcome` is the note's, sent to Fix as context. */
export function SnippetBlock({ snippet, index, outcome = null }: { snippet: Snippet; index: number; outcome?: Outcome | null }) {
  const initial: LanguageId = isLanguageId(snippet.language) ? snippet.language : "text";
  const [language, setLanguage] = useState<LanguageId>(initial);
  const [content, setContent] = useState(snippet.content);
  // A language counts as chosen once the user picks it, or once the block was saved with code in it.
  const [chosen, setChosen] = useState(languageChosen(initial, snippet.content));
  const [copied, setCopied] = useState(false);
  const [fixable, setFixable] = useState(0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  // Output shown under the block: the live run, or the saved latest run on open.
  const saved = snippet.last_run ? fromLastRun(snippet.last_run) : null;
  const [output, setOutput] = useState<Chunk[] | null>(saved?.chunks ?? null);
  const [result, setResult] = useState<RunResult | null>(saved?.result ?? null);
  const [ranHash, setRanHash] = useState<string | null>(snippet.last_run?.code_hash ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fix, setFix] = useState<{ before: string; code: string; summary: string } | null>(null);
  const [fixing, setFixing] = useState(false);
  const handle = useRef<RunHandle | null>(null);
  // Figures, tables and charts: the live run's until it's saved, then the stored run's.
  const [live, setLive] = useState<CapturedOutputs | null>(null);
  const [hideSaved, setHideSaved] = useState(false);
  const savedOutputs = hideSaved ? null : (snippet.last_run?.outputs ?? null);
  const latestSaved = useRef(snippet.last_run?.outputs ?? null);
  latestSaved.current = snippet.last_run?.outputs ?? null;
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
      .catch((e: Error) => !gone && setSaveError(`Figures couldn’t load: ${e.message}`));
    return () => {
      gone = true;
    };
  }, [savedOutputs]);
  const plan = usePlan();
  const { flush } = useAutosave({ language, content }, (v) => updateSnippet(snippet, v), {
    baseline: { language: initial, content: snippet.content },
  });
  const runnable = runsInBrowser(language);
  const serverable = runsOnServer(language);
  const pro = plan === "pro";
  const lastError = result?.outcome === "error" ? result.error?.text ?? "" : "";
  const hash = useMemo(() => codeHash(content), [content]);
  const stale = !running && output !== null && ranHash !== null && ranHash !== hash;

  /** Saves (or clears) the latest run; a failure shows under the output, the run itself still shows. */
  function persist(run: Parameters<typeof saveLastRun>[1]) {
    setSaveError(null);
    saveLastRun(snippet, run).catch((e: Error) => setSaveError(`Output not saved: ${e.message}`));
  }

  /** Uploads the run's outputs, saves the run, then deletes the run it replaced. */
  async function persistRun(chunks: Chunk[], r: RunResult, where: "browser" | "server", code: string) {
    setSaveError(null);
    const previous = latestSaved.current;
    let saved = null;
    if (r.outputs) {
      try {
        const [{ addStaticRenders }, m] = await Promise.all([import("@/lib/charts"), outputStore()]);
        saved = await m.uploadOutputs(snippet.id, await addStaticRenders(r.outputs));
      } catch (e) {
        setSaveError(`Figures not saved: ${(e as Error).message}`);
      }
    }
    try {
      await saveLastRun(snippet, toLastRun(chunks, r, where, code, new Date(), saved));
      setLive(null);
      setHideSaved(false);
      if (previous && previous.dir !== saved?.dir) void (await outputStore()).deleteOutputs(previous).catch(() => {});
    } catch (e) {
      setSaveError(`Output not saved: ${(e as Error).message}`);
      if (saved) void (await outputStore()).deleteOutputs(saved).catch(() => {});
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
    const { zip } = await import("@/lib/zip");
    const base = downloadName(snippet.filename, language, index).replace(/\.[^.]*$/, "");
    saveBlob(`${base}-run.zip`, new Blob([zip(runArchiveEntries(text, outputs)) as BlobPart], { type: "application/zip" }));
  }

  function edit(next: string) {
    setContent(next);
    if (!chosen) setLanguage(detectLanguage(next) ?? initial);
  }

  function pickLanguage(next: LanguageId) {
    setLanguage(next);
    setChosen(true);
    setFixable(0);
  }

  /** Runs in the browser (free) or on the server (Pro); both report through RunOutput. */
  async function run(where: "browser" | "server" = "browser") {
    const lang = language;
    const inBrowser = where === "browser" && runsInBrowser(lang);
    if (!inBrowser && !(where === "server" && serverable && pro)) return;
    const code = content;
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
    const h =
      inBrowser && runsInBrowser(lang)
        ? (await import("@/lib/run/runner")).runCode(lang, code, { onStatus: setStatus, onOutput })
        : (await import("@/lib/run/server-client")).runOnServer(lang, code, onOutput, setStatus);
    handle.current = h;
    const r = await h.done;
    handle.current = null;
    setStatus("");
    setResult(r);
    setRunning(false);
    if (r.outputs) setLive(r.outputs);
    void persistRun(chunks, r, inBrowser ? "browser" : "server", code);
  }

  async function proposeFix() {
    setFixing(true);
    try {
      const { requestFix } = await import("@/lib/run/server-client");
      const answer = await requestFix(language, content, lastError, outcome);
      setFix({ before: content, code: answer.code, summary: answer.summary });
    } catch (e) {
      setFix({ before: content, code: content, summary: (e as Error).message });
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
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function remove() {
    if (content.trim() && !window.confirm("Remove this code?")) return;
    handle.current?.stop();
    await flush();
    const previous = latestSaved.current;
    await deleteSnippet(snippet);
    if (previous) void outputStore().then((m) => m.deleteOutputs(previous)).catch(() => {});
  }

  return (
    <div className="border-t border-line">
      <SnippetHeader
        filename={snippet.filename}
        language={
          <select
            value={language}
            onChange={(e) => pickLanguage(e.target.value as LanguageId)}
            aria-label={`Language of code ${index + 1}`}
            className="-ml-1 min-h-12 shrink-0 cursor-pointer appearance-none bg-transparent px-1 outline-none hover:text-fg"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        }
        actions={
          running ? (
            <Button onClick={() => handle.current?.stop()} variant="neutral">
              Stop
            </Button>
          ) : (
            <div className="flex items-center gap-4">
              {serverable && pro && (
                <TextButton onClick={() => run("server")} strong={!runnable}>
                  Run on server
                </TextButton>
              )}
              {serverable && plan === "free" && !runnable && <span className="text-xs text-faint">Server runs · Pro</span>}
              {runnable && <Button onClick={() => run("browser")}>Run</Button>}
            </div>
          )
        }
      />

      <CodeEditor
        value={content}
        onChange={edit}
        language={language}
        label={`Code ${index + 1}`}
        errorLine={stale ? null : result?.error?.line ?? null}
        onFixable={setFixable}
      />

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
          hrefs={savedOutputs.items.map((_, i) => outputPagePath(snippet.entry_id, snippet.id, i))}
        />
      ) : null}

      {fix && <FixDiff before={fix.before} after={fix.code} summary={fix.summary} onAccept={acceptFix} onReject={() => setFix(null)} />}

      <div className="flex gap-5 pb-1">
        <TextButton onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </TextButton>
        <TextButton onClick={() => saveText(downloadName(snippet.filename, language, index), content)}>
          Download
        </TextButton>
        {lastError && !running && !fix && (
          <TextButton onClick={proposeFix} disabled={fixing}>
            {fixing ? "Fixing…" : "Fix"}
          </TextButton>
        )}
        {language === "python" && fixable > 0 && (
          <TextButton onClick={autofix}>
            Autofix
          </TextButton>
        )}
        <TextButton onClick={remove} className="ml-auto">
          Remove
        </TextButton>
      </div>
    </div>
  );
}
