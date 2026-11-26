"use client";
// R in the browser: WebR (R compiled to WebAssembly, from r-wasm.org) runs the cell in its own
// worker, kept warm between runs. Packages the code names are loaded first (WebR's own builds of
// CRAN); printed output arrives as it happens, base and ggplot2 plots come back as PNG figures.
// Stop throws the R session away; the next run starts a new one (from the browser's cache).
import type { CapturedOutputs, Manifest } from "./outputs";
import { cleanRError, rPackages } from "./r-packages";
import { SETUP_TIMEOUT_MS, type RunEvents, type RunHandle, type RunResult, type Stream } from "./types";

/** WebR's release (R 4.6.0), from its own CDN. Checked in a real browser on 2026-11-18. */
export const WEBR_URL = "https://webr.r-wasm.org/v0.6.0/webr.mjs";
const MAIN = "/home/web_user/main.R";
/** Runs the cell as R's own source() does (values print as at the prompt) and keeps an error's text instead of stopping R. */
const WRAP = `.bj_err <- tryCatch({ source("${MAIN}", print.eval = TRUE, keep.source = TRUE); "" }, error = function(e) { cl <- conditionCall(e); paste0("Error", if (!is.null(cl)) paste0(" in ", paste(deparse(cl), collapse = " ")), ": ", conditionMessage(e)) })`;
const FIGURE = { width: 800, height: 600 };
export const R_SETUP_TIMEOUT_TEXT = `R didn't finish loading in ${SETUP_TIMEOUT_MS / 60_000} min. Check your connection and run again (what downloaded is kept).`;

interface WebRSession {
  init(): Promise<void>;
  read(): Promise<{ type: string; data: unknown }>;
  installPackages(packages: string[], options?: { quiet?: boolean }): Promise<void>;
  evalRString(code: string): Promise<string>;
  FS: { writeFile(path: string, data: Uint8Array): Promise<void> };
  Shelter: new () => Promise<{ captureR(code: string, options: Record<string, unknown>): Promise<{ images: ImageBitmap[] }>; purge(): Promise<void> }>;
  close(): void;
  destroy?: () => void;
}

let session: Promise<WebRSession> | null = null;
/** Where R's printed output goes while a run is going; nothing listens between runs. */
let sink: ((stream: Stream, text: string) => void) | null = null;

function start(): Promise<WebRSession> {
  return (session ??= (async () => {
    const { WebR } = (await import(/* webpackIgnore: true */ WEBR_URL)) as { WebR: new () => WebRSession };
    const r = new WebR();
    await r.init();
    void (async () => {
      for (;;) {
        const m = await r.read();
        if ((m.type === "stdout" || m.type === "stderr") && typeof m.data === "string") sink?.(m.type, m.data + "\n");
      }
    })().catch(() => {});
    return r;
  })());
}

function discard() {
  const old = session;
  session = null;
  sink = null;
  void old?.then((r) => (r.destroy ? r.destroy() : r.close())).catch(() => {});
}

/** Which of `packages` R doesn't have yet. */
async function missing(r: WebRSession, packages: string[]): Promise<string[]> {
  const list = packages.map((p) => JSON.stringify(p)).join(", ");
  const out = await r.evalRString(`paste(setdiff(c(${list}), rownames(installed.packages())), collapse = "\\n")`);
  return out ? out.split("\n") : [];
}

async function toPng(image: ImageBitmap): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
}

/** The run's plots as outputs (the same shape Python's figures have). */
async function figures(images: ImageBitmap[]): Promise<CapturedOutputs | null> {
  const files: Record<string, Uint8Array> = {};
  const items: Manifest["items"] = [];
  for (const image of images.slice(0, 30)) {
    const name = `${items.length}.png`;
    const bytes = await toPng(image);
    if (!bytes.length) continue;
    files[name] = bytes;
    items.push({ kind: "image", source: "file", width: image.width, height: image.height, title: "", files: { png: name } });
  }
  return items.length ? { manifest: { version: 1, items, notes: [] }, files } : null;
}

export function runR(code: string, events: RunEvents, timeoutMs: number | null): RunHandle {
  let settled = false;
  let started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (r: RunResult) => void = () => {};
  const done = new Promise<RunResult>((resolve) => (finish = resolve));
  const elapsed = () => (started ? performance.now() - started : 0);
  const settle = (r: RunResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    sink = null;
    events.onStatus("");
    finish(r);
  };
  // Stopping R means throwing its session away, as stopping Python throws its worker away.
  const kill = (outcome: "stopped" | "timeout" | "setup-timeout") => {
    if (settled) return;
    discard();
    if (outcome === "setup-timeout") settle({ outcome: "error", error: { text: R_SETUP_TIMEOUT_TEXT, line: null }, ms: 0 });
    else settle({ outcome, error: null, ms: elapsed(), ...(outcome === "timeout" && timeoutMs !== null ? { limitMs: timeoutMs } : {}) });
  };

  void (async () => {
    events.onStatus("Starting R…");
    timer = setTimeout(() => kill("setup-timeout"), SETUP_TIMEOUT_MS);
    const r = await start();
    if (settled) return;
    const wanted = rPackages(code);
    let need = wanted.length ? await missing(r, wanted) : [];
    if (need.length) {
      events.onStatus(`Loading R packages: ${need.join(", ")}…`);
      await r.installPackages(need, { quiet: true });
      need = await missing(r, need);
      if (settled) return;
      if (need.length) {
        // No browser build of it: nothing ran, and Run goes on to the server.
        const names = need.map((n) => `‘${n}’`).join(", ");
        settle({ outcome: "error", error: { text: `The R package${need.length === 1 ? "" : "s"} ${names} ${need.length === 1 ? "has" : "have"} no browser build.`, line: null }, ms: 0, needsServer: true });
        return;
      }
    }
    clearTimeout(timer);
    await r.FS.writeFile(MAIN, new TextEncoder().encode(code));
    if (settled) return;
    sink = events.onOutput;
    started = performance.now();
    events.onStatus("");
    if (timeoutMs !== null) timer = setTimeout(() => kill("timeout"), timeoutMs);
    const shelter = await new r.Shelter();
    const { images } = await shelter.captureR(WRAP, { withAutoprint: false, captureStreams: false, captureConditions: false, captureGraphics: FIGURE });
    const ms = elapsed();
    clearTimeout(timer);
    const error = await r.evalRString(".bj_err");
    if (settled) return;
    // Printed lines still on their way arrive before this turn of the loop ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (images.length) events.onStatus("Drawing figures…");
    const outputs = await figures(images);
    void shelter.purge().catch(() => {});
    settle({ outcome: error ? "error" : "ok", error: error ? cleanRError(error) : null, ms, ...(outputs ? { outputs } : {}) });
  })().catch((e: unknown) => {
    if (settled) return;
    discard();
    console.error("R run failed to start", e);
    settle({ outcome: "error", error: { text: "R couldn’t start. Check your connection and run again.", line: null }, ms: elapsed() });
  });

  return { done, stop: () => kill("stopped") };
}
