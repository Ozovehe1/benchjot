"use client";
// Runs a code block in the browser: Python in the Pyodide worker (kept warm),
// JS/TS in a fresh sandboxed worker per run. The time limit counts from the moment
// the code starts ("start"): Python's setup before it (Pyodide, downloading and importing
// the code's packages) has its own, longer limit (SETUP_TIMEOUT_MS). Stop works in both.
import { cleanPythonTraceback, jsErrorLine, pythonErrorLine } from "./errors";
import { transpile } from "./transpile";

import { RUN_TIMEOUT_MS, SETUP_TIMEOUT_MS, SETUP_TIMEOUT_TEXT, type BrowserLanguage, type RunEvents, type RunHandle, type RunResult } from "./types";
import type { FigureFormat } from "./outputs";
import { FriendlyError, messageFor } from "../user-message";

let pythonWorker: Worker | null = null;
let nextId = 1;
/** Downloads waiting on the Python worker; a Stop or time limit that throws it away fails them. */
const pendingRenders = new Set<(e: Error) => void>();

function worker(language: BrowserLanguage): Worker {
  if (language === "python") return (pythonWorker ??= new Worker("/workers/python.js"));
  return new Worker("/workers/js.js");
}

export function runCode(language: BrowserLanguage, code: string, events: RunEvents, timeoutMs = RUN_TIMEOUT_MS): RunHandle {
  let source = code;
  if (language !== "python") {
    const t = transpile(code, language);
    if (!t.ok) {
      const { message, line, column } = t.issue;
      return {
        done: Promise.resolve({ outcome: "error", error: { text: `SyntaxError: ${message} (line ${line}:${column})`, line }, ms: 0 }),
        stop: () => {},
      };
    }
    source = t.code;
  }

  const id = nextId++;
  const w = worker(language);
  let started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (r: RunResult) => void = () => {};
  let outputs: RunResult["outputs"] = null;
  const elapsed = () => (started ? performance.now() - started : 0);

  const end = (r: RunResult) => {
    clearTimeout(timer);
    w.removeEventListener("message", onMessage);
    if (language !== "python") w.terminate();
    finish(outputs ? { ...r, outputs } : r);
  };

  // Stopping Python means throwing its worker away; the next run loads it again (from cache).
  const kill = (outcome: "timeout" | "stopped" | "setup-timeout") => {
    w.terminate();
    if (language === "python") {
      pythonWorker = null;
      for (const fail of [...pendingRenders]) fail(new FriendlyError("Python was stopped while making the file. Try the download again."));
    }
    if (outcome === "setup-timeout") end({ outcome: "error", error: { text: SETUP_TIMEOUT_TEXT, line: null }, ms: 0 });
    else end({ outcome, error: null, ms: elapsed() });
  };

  function onMessage({ data }: MessageEvent) {
    if (data.id !== id) return;
    switch (data.type) {
      case "status":
        events.onStatus(data.text);
        break;
      case "start":
        clearTimeout(timer);
        started = performance.now();
        events.onStatus("");
        timer = setTimeout(() => kill("timeout"), timeoutMs);
        break;
      case "out":
        events.onOutput(data.stream, data.text);
        break;
      case "outputs":
        outputs = data.outputs;
        break;
      case "done":
        end({ outcome: "ok", error: null, ms: elapsed() });
        break;
      case "error": {
        // Setup's own message (couldn't download …): for the user as is, no code line.
        if (data.setup) {
          end({ outcome: "error", error: { text: data.text, line: null }, ms: 0 });
          break;
        }
        const text = language === "python" ? cleanPythonTraceback(data.text) : data.text;
        const line = language === "python" ? pythonErrorLine(data.text) : jsErrorLine(data.text);
        end({ outcome: "error", error: { text: language === "python" ? text : firstLine(text), line }, ms: elapsed() });
        break;
      }
    }
  }

  const done = new Promise<RunResult>((resolve) => {
    finish = resolve;
  });
  w.addEventListener("message", onMessage);
  // A message here is the user's own uncaught error (shown as is); none means the worker itself failed to load.
  w.addEventListener("error", (e) => end({ outcome: "error", error: { text: e.message || messageFor("unknown", "runner_start"), line: null }, ms: elapsed() }), { once: true });
  w.postMessage({ id, code: source });
  if (language === "python") timer = setTimeout(() => kill("setup-timeout"), SETUP_TIMEOUT_MS);
  return { done, stop: () => kill("stopped") };
}

/**
 * A figure's SVG or PDF, made by matplotlib from the figure the run kept (bj_capture.render),
 * in the same Pyodide worker as runs (loaded first when it isn't yet). `matplotlib`: the
 * version that kept it, from the manifest; another version can't load it and says so.
 */
export function renderFigure(data: Uint8Array, format: FigureFormat, matplotlib: string | undefined): Promise<Uint8Array> {
  const id = nextId++;
  const w = worker("python");
  return new Promise<Uint8Array>((resolve, reject) => {
    const settle = () => {
      w.removeEventListener("message", onMessage);
      pendingRenders.delete(fail);
    };
    const fail = (e: Error) => {
      settle();
      reject(e);
    };
    function onMessage({ data: m }: MessageEvent) {
      if (m.id !== id) return;
      if (m.type === "rendered") {
        settle();
        resolve(m.data);
      } else if (m.type === "error") {
        fail(m.user ? new FriendlyError(m.user) : new Error(m.text));
      }
    }
    pendingRenders.add(fail);
    w.addEventListener("message", onMessage);
    // A copy goes to the worker: the caller's bytes stay usable.
    w.postMessage({ id, render: { data: data.slice(), format, matplotlib } });
  });
}

/** JS stacks are long; the first line ("TypeError: x is not a function") is what matters. */
function firstLine(stack: string): string {
  return stack.split("\n")[0] ?? stack;
}
