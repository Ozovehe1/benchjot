// Server-side only: runs one snippet in a fresh Modal Sandbox and returns its output.
// Limits (CPU, memory, time, optional GPU) come from server-languages.ts.
//
// The code runs as an exec in an idle sandbox, not as the sandbox's own command: a
// sandbox command's stdout reaches us through Modal's log stream, which cuts lines at
// 64 KiB and drops output that arrives fast (bj_capture's outputs bundle is one long
// line), while an exec's stdout is streamed whole, as Modal's own file reads rely on.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModalClient, type Image } from "modal";
import {
  buildCommand,
  capOutput,
  IMAGES,
  LIMITS,
  outcomeOf,
  PYTHON_PREINSTALLED,
  SERVER_LANGUAGES,
  SERVER_OUTPUT_BYTES,
  serverErrorLine,
  sourceFiles,
  splitBundle,
  WORKDIR,
  type Directives,
  type ImageId,
  type ServerLanguageId,
  type ServerRunResponse,
} from "../run/server-languages";

const APP_NAME = "benchjot-runs";
let capture: string | undefined;
/** public/workers/bj_capture.py: the same capture the browser runs (bundled via next.config outputFileTracingIncludes). */
const captureSource = () => (capture ??= readFileSync(join(process.cwd(), "public/workers/bj_capture.py"), "utf8"));
let client: ModalClient | undefined;

function modal(): ModalClient {
  const tokenId = process.env.MODAL_TOKEN_ID;
  const tokenSecret = process.env.MODAL_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) throw new Error("Server runs are not configured (MODAL_TOKEN_ID / MODAL_TOKEN_SECRET)");
  client ??= new ModalClient({ tokenId, tokenSecret });
  return client;
}

function image(m: ModalClient, id: ImageId): Image {
  const base = m.images.fromRegistry(IMAGES[id]);
  return id === "python" ? base.dockerfileCommands([`RUN pip install --no-cache-dir ${PYTHON_PREINSTALLED.join(" ")}`]) : base;
}

export async function runOnModal(language: ServerLanguageId, code: string, d: Directives, signal?: AbortSignal): Promise<ServerRunResponse> {
  const m = modal();
  const app = await m.apps.fromName(APP_NAME, { createIfMissing: true });
  const started = Date.now();
  // No command: the sandbox idles until terminated; timeoutMs is the hard backstop
  // (`timeout` inside the command stops the code first).
  const sb = await m.sandboxes.create(app, image(m, SERVER_LANGUAGES[language].image), {
    cpu: LIMITS.cpu,
    cpuLimit: LIMITS.cpu,
    memoryMiB: LIMITS.memoryMiB,
    memoryLimitMiB: d.gpu ? LIMITS.gpuMemoryLimitMiB : LIMITS.memoryLimitMiB,
    timeoutMs: (d.timeoutSec + 60) * 1000,
    blockNetwork: d.packages.length === 0, // network only to install packages
    ...(d.gpu ? { gpu: d.gpu } : {}),
  });
  const stop = () => void sb.terminate().catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for (const [name, text] of Object.entries(sourceFiles(language, code, language === "python" ? captureSource() : ""))) {
      await sb.filesystem.writeText(text, `${WORKDIR}/${name}`);
    }
    const run = await sb.exec(buildCommand(language, d), {
      mode: "text",
      env: language === "python" ? { BJ_MAX_TOTAL_BYTES: String(SERVER_OUTPUT_BYTES) } : {},
    });
    const [raw, stderr, exitCode] = await Promise.all([run.stdout.readText(), run.stderr.readText(), run.wait()]);
    const { stdout, outputs } = language === "python" ? splitBundle(raw) : { stdout: raw, outputs: null };
    return {
      outcome: outcomeOf(exitCode),
      outputs,
      stdout: capOutput(stdout),
      stderr: capOutput(stderr),
      exitCode,
      ms: Date.now() - started,
      line: exitCode === 0 ? null : serverErrorLine(language, stderr),
    };
  } finally {
    signal?.removeEventListener("abort", stop);
    stop();
  }
}
