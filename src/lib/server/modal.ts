// Server-side only: runs one cell in a fresh Modal Sandbox and returns its output.
// Limits (CPU, memory, time, optional GPU) come from server-languages.ts.
// The network is closed while the code runs unless the cell asks (`# network:`): `# pip:`
// packages are installed into the image as a cached layer, not inside the sandbox.
//
// A run that waits in the request (runOnModal) runs as an exec in an idle sandbox: a sandbox
// command's stdout reaches us through Modal's log stream, which cuts lines at 64 KiB and drops
// output that arrives fast (bj_capture's outputs bundle is one long line), while an exec's stdout
// is streamed whole. A background run (startOnModal) is the sandbox's own command, bj_job.py, which
// writes the output to files and sends it back itself, so no stream is involved.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModalClient, type Image, type Sandbox } from "modal";
import {
  autoInstallNote,
  buildCommand,
  finishRun,
  CACHE_DIR,
  cacheEnv,
  cacheVolumeName,
  capturesOutputs,
  imageLayers,
  IMAGES,
  LIMITS,
  pythonImageLayers,
  sandboxNetwork,
  SERVER_LANGUAGES,
  SERVER_OUTPUT_BYTES,
  sourceFiles,
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
let job: string | undefined;
/** src/lib/server/bj_job.py: runs a background run's code and sends its result back (bundled like bj_capture). */
const jobSource = () => (job ??= readFileSync(join(process.cwd(), "src/lib/server/bj_job.py"), "utf8"));
let client: ModalClient | undefined;

function modal(): ModalClient {
  const tokenId = process.env.MODAL_TOKEN_ID;
  const tokenSecret = process.env.MODAL_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) throw new Error("Server runs are not configured (MODAL_TOKEN_ID / MODAL_TOKEN_SECRET)");
  client ??= new ModalClient({ tokenId, tokenSecret });
  return client;
}

/** The image a run starts from: the language's base, and for Python the preinstalled set plus the cell's `# pip:` layer. */
function image(m: ModalClient, id: ImageId, packages: readonly string[] = []): Image {
  const base = m.images.fromRegistry(IMAGES[id]);
  const layers = id === "python" ? pythonImageLayers(packages) : imageLayers(id);
  return layers.reduce((img, layer) => img.dockerfileCommands(layer), base);
}

/** The sandbox's size and lifetime for a run (`extraSec`: time it may live past the code's limit). */
function sandboxOptions(d: Directives, extraSec: number, alwaysHosts: readonly string[] = []) {
  return {
    cpu: LIMITS.cpu,
    cpuLimit: LIMITS.cpu,
    memoryMiB: LIMITS.memoryMiB,
    memoryLimitMiB: d.gpu ? LIMITS.gpuMemoryLimitMiB : LIMITS.memoryLimitMiB,
    timeoutMs: (d.timeoutSec + extraSec) * 1000,
    ...sandboxNetwork(d.network, alwaysHosts),
    ...(d.gpu ? { gpu: d.gpu } : {}),
  };
}

/**
 * A sandbox from the run's image. The cell's other imports install with its `# pip:` packages; a
 * name pip can't find fails that layer's build, so the run goes ahead without them and says why.
 */
async function createSandbox(m: ModalClient, language: ServerLanguageId, d: Directives, base: Parameters<ModalClient["sandboxes"]["create"]>[2], userId?: string): Promise<{ sb: Sandbox; note: string }> {
  const app = await m.apps.fromName(APP_NAME, { createIfMissing: true });
  const options = { ...base, ...(await userCache(m, userId, base?.env)) };
  const imageId = SERVER_LANGUAGES[language].image;
  try {
    return { sb: await m.sandboxes.create(app, image(m, imageId, [...d.packages, ...d.auto]), options), note: "" };
  } catch (e) {
    if (!d.auto.length) throw e;
    console.error("auto-install layer failed", d.auto, e);
    return { sb: await m.sandboxes.create(app, image(m, imageId, d.packages), options), note: autoInstallNote(d.auto) };
  }
}

/**
 * The user's own download cache: a persistent volume mounted at CACHE_DIR, with the loaders'
 * caches pointed at it (cacheEnv), so a dataset or model downloaded once is there next time.
 * One volume per user: a shared one would let a user plant files another user's code loads.
 * Without a user, or if the volume can't be had, the run goes ahead without a cache.
 */
async function userCache(m: ModalClient, userId: string | undefined, env: Record<string, string> | undefined) {
  const name = userId ? cacheVolumeName(userId) : null;
  if (!name) return {};
  try {
    const volume = await m.volumes.fromName(name, { createIfMissing: true });
    return { volumes: { [CACHE_DIR]: volume }, env: { ...cacheEnv(), ...(env ?? {}) } };
  } catch (e) {
    console.error("cache volume unavailable", e);
    return {};
  }
}

/**
 * Starts a background run (Python): the sandbox's own command waits for its files, then bj_job.py
 * runs the code under its time limit and POSTs the raw result to `callback` with `token`. Returns
 * at once; the sandbox ends when the job has sent its result (or at its own deadline).
 * `appHost`: reachable whatever the cell's network says, so the result can come back.
 */
export async function startOnModal(code: string, d: Directives, env: Record<string, string>, job: { callback: string; token: string; appHost: string; userId?: string }): Promise<{ sandboxId: string; note: string }> {
  const m = modal();
  const { sb, note } = await createSandbox(m, "python", d, {
    ...sandboxOptions(d, 180, [job.appHost]),
    env: { ...env, BJ_MAX_TOTAL_BYTES: String(SERVER_OUTPUT_BYTES) },
    command: ["sh", "-c", `while [ ! -f ${WORKDIR}/.go ]; do sleep 0.2; done; exec python3 -u ${WORKDIR}/.bj_job.py`],
  }, job.userId);
  try {
    for (const [name, text] of Object.entries(sourceFiles("python", code, captureSource()))) await sb.filesystem.writeText(text, `${WORKDIR}/${name}`);
    await sb.filesystem.writeText(jobSource(), `${WORKDIR}/.bj_job.py`);
    await sb.filesystem.writeText(JSON.stringify({ command: buildCommand("python", d), callback: job.callback, token: job.token }), `${WORKDIR}/.job.json`);
    await sb.filesystem.writeText("", `${WORKDIR}/.go`);
    return { sandboxId: sb.sandboxId, note };
  } catch (e) {
    void sb.terminate().catch(() => {});
    throw e;
  }
}

/** Stops a background run's sandbox (gone already is fine). */
export async function stopOnModal(sandboxId: string): Promise<void> {
  const sb = await modal().sandboxes.fromId(sandboxId).catch(() => null);
  await sb?.terminate().catch(() => {});
}

/**
 * What a background run is doing right now, from the .status.json its sandbox keeps (bj_job.py):
 * the phase, how long the code has run, and its latest line of output. null while the machine is
 * still starting (no file yet), or when it can't be read in `withinMs` (the page just asks again).
 */
export async function liveStatus(sandboxId: string, withinMs = 4000): Promise<unknown | null> {
  const read = (async () => {
    const sb = await modal().sandboxes.fromId(sandboxId);
    return JSON.parse(await sb.filesystem.readText(`${WORKDIR}/.status.json`)) as unknown;
  })().catch(() => null);
  return Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), withinMs))]);
}

/** Whether a background run's sandbox is still running (false when it ended or can't be found). */
export async function sandboxRunning(sandboxId: string): Promise<boolean> {
  try {
    const sb = await modal().sandboxes.fromId(sandboxId);
    return (await sb.poll()) === null;
  } catch {
    return false;
  }
}

/** `env`: extra environment for the code (the caller's dataset keys, datasetEnv). */
export async function runOnModal(language: ServerLanguageId, code: string, d: Directives, signal?: AbortSignal, env: Record<string, string> = {}, userId?: string): Promise<ServerRunResponse> {
  const m = modal();
  const started = Date.now();
  // No command: the sandbox idles until terminated; timeoutMs is the hard backstop
  // (`timeout` inside the command stops the code first).
  const { sb, note } = await createSandbox(m, language, d, sandboxOptions(d, 60), userId);
  const cached = userId && cacheVolumeName(userId) ? cacheEnv() : {};
  const stop = () => void sb.terminate().catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for (const [name, text] of Object.entries(sourceFiles(language, code, capturesOutputs(language) ? captureSource() : ""))) {
      await sb.filesystem.writeText(text, `${WORKDIR}/${name}`);
    }
    const run = await sb.exec(buildCommand(language, d), {
      mode: "text",
      env: capturesOutputs(language) ? { ...cached, ...env, BJ_MAX_TOTAL_BYTES: String(SERVER_OUTPUT_BYTES) } : { ...cached, ...env },
    });
    const [raw, stderr, exitCode] = await Promise.all([run.stdout.readText(), run.stderr.readText(), run.wait()]);
    return finishRun({ language, gpu: d.gpu, network: d.network, note }, raw, stderr, exitCode, Date.now() - started);
  } finally {
    signal?.removeEventListener("abort", stop);
    stop();
  }
}
