"use client";
// Runs a code block in the browser: Python in the Pyodide worker (kept warm),
// JS/TS in a fresh sandboxed worker per run. Time limit counts from the moment
// the code starts (Python's first load and package downloads don't count).
import { cleanPythonTraceback, jsErrorLine, pythonErrorLine } from "./errors";
import { transpile } from "./transpile";

import { RUN_TIMEOUT_MS, type BrowserLanguage, type RunEvents, type RunHandle, type RunResult } from "./types";

let pythonWorker: Worker | null = null;
let nextId = 1;

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
  const kill = (outcome: "timeout" | "stopped") => {
    w.terminate();
    if (language === "python") pythonWorker = null;
    end({ outcome, error: null, ms: elapsed() });
  };

  function onMessage({ data }: MessageEvent) {
    if (data.id !== id) return;
    switch (data.type) {
      case "status":
        events.onStatus(data.text);
        break;
      case "start":
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
  w.addEventListener("error", (e) => end({ outcome: "error", error: { text: e.message || "The runner failed to start.", line: null }, ms: elapsed() }), { once: true });
  w.postMessage({ id, code: source });
  return { done, stop: () => kill("stopped") };
}

/** JS stacks are long; the first line ("TypeError: x is not a function") is what matters. */
function firstLine(stack: string): string {
  return stack.split("\n")[0] ?? stack;
}
