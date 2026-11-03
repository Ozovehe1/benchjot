"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAutosave } from "@/lib/autosave";
import { deleteSnippet, updateSnippet } from "@/lib/data";
import { detectLanguage } from "@/lib/detect-language";
import { downloadName, isLanguageId, LANGUAGES, type LanguageId } from "@/lib/languages";
import type { Snippet } from "@/lib/schemas";
import { runsInBrowser, type RunHandle, type RunResult, type Stream } from "@/lib/run/types";
import { RunOutput, type OutputChunk } from "./run-output";
import { TextButton } from "./ui";

const CodeEditor = dynamic(() => import("./code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="min-h-[72px]" />,
});

const MAX_OUTPUT = 200_000;

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SnippetBlock({ snippet, index }: { snippet: Snippet; index: number }) {
  const initial: LanguageId = isLanguageId(snippet.language) ? snippet.language : "text";
  const [language, setLanguage] = useState<LanguageId>(initial);
  const [content, setContent] = useState(snippet.content);
  // A language counts as chosen once the user picks it, or once the block was saved with code in it.
  const [chosen, setChosen] = useState(initial !== "text" || snippet.content.trim() !== "");
  const [copied, setCopied] = useState(false);
  const [fixable, setFixable] = useState(0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [output, setOutput] = useState<OutputChunk[] | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const handle = useRef<RunHandle | null>(null);
  const { flush } = useAutosave({ language, content }, (v) => updateSnippet(snippet.id, v), {
    baseline: { language: initial, content: snippet.content },
  });
  const runnable = runsInBrowser(language);

  function edit(next: string) {
    setContent(next);
    if (!chosen) setLanguage(detectLanguage(next) ?? "text");
  }

  function pickLanguage(next: LanguageId) {
    setLanguage(next);
    setChosen(true);
    setFixable(0);
  }

  async function run() {
    if (!runsInBrowser(language)) return;
    const { runCode } = await import("@/lib/run/runner");
    let size = 0;
    setOutput([]);
    setResult(null);
    setRunning(true);
    const h = runCode(language, content, {
      onStatus: setStatus,
      onOutput: (stream: Stream, text: string) => {
        if (size > MAX_OUTPUT) return;
        size += text.length;
        setOutput((o) => [...(o ?? []), { stream, text: size > MAX_OUTPUT ? text + "\n[output truncated]\n" : text }]);
      },
    });
    handle.current = h;
    const r = await h.done;
    handle.current = null;
    setStatus("");
    setResult(r);
    setRunning(false);
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
    await deleteSnippet(snippet);
  }

  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 font-mono text-xs text-muted">
          {snippet.filename && <span className="min-w-0 truncate">{snippet.filename}</span>}
          <select
            value={language}
            onChange={(e) => pickLanguage(e.target.value as LanguageId)}
            aria-label={`Language of code ${index + 1}`}
            className="-ml-1 min-h-11 shrink-0 cursor-pointer appearance-none bg-transparent px-1 outline-none hover:text-fg"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        {runnable &&
          (running ? (
            <TextButton onClick={() => handle.current?.stop()} className="text-fg">
              Stop
            </TextButton>
          ) : (
            <TextButton onClick={run} className="text-fg">
              Run
            </TextButton>
          ))}
      </div>

      <CodeEditor
        value={content}
        onChange={edit}
        language={language}
        label={`Code ${index + 1}`}
        errorLine={result?.error?.line ?? null}
        onFixable={setFixable}
      />

      {output && (
        <RunOutput chunks={output} status={status} running={running} result={result} onClear={() => (setOutput(null), setResult(null))} />
      )}

      <div className="flex gap-5 pb-2 text-xs">
        <TextButton onClick={copy} className="text-xs">
          {copied ? "Copied" : "Copy"}
        </TextButton>
        <TextButton onClick={() => download(downloadName(snippet.filename, language, index), content)} className="text-xs">
          Download
        </TextButton>
        {language === "python" && fixable > 0 && (
          <TextButton onClick={autofix} className="text-xs">
            Autofix
          </TextButton>
        )}
        <TextButton onClick={remove} className="ml-auto text-xs">
          Remove
        </TextButton>
      </div>
    </div>
  );
}
