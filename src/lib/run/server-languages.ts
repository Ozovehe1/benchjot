// Server runs (on Modal, for every account): which languages, which image, how to build and
// run them, the limits, and the per-cell directives read from comments.
// Pure data and string building, shared by the API route, the UI and the tests.
import { languageConfig } from "../code/languages";
import pythonImage from "./python-image.json";
import serverImages from "./server-images.json";
import { JULIA_RUNNER, OCTAVE_RUNNER, R_PROFILE } from "./language-support";
import { missingDistributions } from "./python-imports";

export const IMAGES = {
  python: pythonImage.base,
  gcc: "gcc:14",
  r: serverImages.r.base,
  octave: serverImages.octave.base,
  julia: serverImages.julia.base,
} as const;

/** Dockerfile commands on top of an image's base, one layer each (server-images.json); none for the plain compiler image. */
export function imageLayers(id: ImageId): string[][] {
  const spec = (serverImages as unknown as Record<string, { commands?: string[] } | string>)[id];
  return typeof spec === "object" && spec.commands ? spec.commands.map((c) => [c]) : [];
}
export type ImageId = keyof typeof IMAGES;

/**
 * Packages baked into the Python image (pinned, python-image.json) so research code needs no `# pip:` line:
 * data science, ML and deep learning (TensorFlow with GPU support, Keras 3, PyTorch, JAX on CPU) and
 * simulation (SimPy, Mesa, Numba, SymPy, NetworkX).
 */
export const PYTHON_PREINSTALLED: readonly string[] = pythonImage.packages;
/** The import name → the preinstalled distribution, for messages ("tensorflow" from "tensorflow[and-cuda]==2.21.0"). */
export const PYTHON_PREINSTALLED_NAMES: readonly string[] = pythonImage.packages.map((p) => p.replace(/[[=<>!~].*$/, "").toLowerCase());

/**
 * The Dockerfile commands on top of the Python base image: the environment, the preinstalled set,
 * then the cell's `# pip:` packages as their own layer. Modal caches each layer by its commands, so a
 * package set is installed once and later runs start from it; sorting keeps one set one layer.
 * Packages are validated by parseDirectives (no quotes, spaces or shell characters).
 */
export function pythonImageLayers(packages: readonly string[] = []): string[][] {
  const env = Object.entries(pythonImage.env).map(([k, v]) => `ENV ${k}=${v}`);
  const base = [...env, `RUN pip install --no-cache-dir ${pythonImage.packages.map((p) => `'${p}'`).join(" ")}`];
  const extra = [...new Set(packages)].sort();
  const system: string[][] = [pythonImage.system, pythonImage.datasets].filter((l) => l.length > 0);
  return [base, ...system, ...(extra.length ? [[`RUN pip install --no-cache-dir ${extra.map((p) => `'${p}'`).join(" ")}`]] : [])];
}

/** Server runs return figures, tables and charts inline after this mark on stdout (bj_capture.BUNDLE_MARK). */
export const BUNDLE_MARK = "\n\u0000BJ-OUTPUTS\u0000";
/**
 * Their total size. The answer carries them as base64 (4/3 larger) next to the output text
 * and the manifest, and must stay under the hosting limit (RESPONSE_LIMIT_BYTES).
 */
export const SERVER_OUTPUT_BYTES = 2.5 * 1024 * 1024;
/** Vercel's limit on a function's response body. */
export const RESPONSE_LIMIT_BYTES = 4.5 * 1000 * 1000;

interface ServerLanguage {
  image: ImageId;
  file: string;
  /** Shell that compiles (if needed) and runs `file` from the working directory. */
  run: string;
  /** Finds the user's line in stderr; `last` for tracebacks, `first` for compilers. */
  line: { re: RegExp; pick: "first" | "last" };
  /** Runs under bj_capture.py (figures come back in the outputs bundle after stdout). */
  capture?: boolean;
  /** Files written next to the code (language-support.ts). */
  support?: Record<string, string>;
}

/** `command` under bj_capture.py --collect: the figures it writes come back as outputs. */
const collect = (command: string) => `python3 bj_capture.py --collect out -- ${command}`;


const firstAt = (file: string) => ({ re: new RegExp(`${file.replace(".", "\\.")}:(\\d+)`, "g"), pick: "first" as const });

export const SERVER_LANGUAGES = {
  // Through bj_capture.py (written next to main.py), which captures figures, tables and charts.
  python: { image: "python", file: "main.py", run: "python3 -u bj_capture.py main.py out", capture: true, line: { re: /File "(?:[^"]*\/)?main\.py", line (\d+)/g, pick: "last" } },
  c: { image: "gcc", file: "main.c", run: "gcc -O2 -std=c17 -o main main.c -lm && ./main", line: firstAt("main.c") },
  cpp: { image: "gcc", file: "main.cpp", run: "g++ -O2 -std=c++20 -o main main.cpp && ./main", line: firstAt("main.cpp") },
  // gfortran ships in the gcc image (C, C++ and Fortran); free form (.f90).
  fortran: { image: "gcc", file: "main.f90", run: "gfortran -O2 -o main main.f90 && ./main", line: firstAt("main.f90") },
  // R, MATLAB cells (on GNU Octave: MATLAB itself is proprietary) and Julia, with their figures.
  r: { image: "r", file: "main.R", run: collect("Rscript main.R"), capture: true, support: { ".Rprofile": R_PROFILE }, line: { re: /main\.R[:#](\d+)/g, pick: "first" } },
  matlab: { image: "octave", file: "main.m", run: collect("octave --no-gui --quiet --no-window-system bj_run.m"), capture: true, support: { "bj_run.m": OCTAVE_RUNNER }, line: { re: /main\.m:(\d+)|near line (\d+)/g, pick: "first" } },
  julia: { image: "julia", file: "main.jl", run: collect("julia bj_run.jl"), capture: true, support: { "bj_run.jl": JULIA_RUNNER }, line: firstAt("main.jl") },
} as const satisfies Record<string, ServerLanguage>;
export type ServerLanguageId = keyof typeof SERVER_LANGUAGES;

export function runsOnServer(language: string): language is ServerLanguageId {
  return Object.hasOwn(SERVER_LANGUAGES, language);
}

export const LIMITS = {
  // Deep learning (TensorFlow / PyTorch import alone is ~1 GB) needs more than plain scripts.
  cpu: 4,
  memoryMiB: 4096,
  memoryLimitMiB: 8192,
  gpuMemoryLimitMiB: 16384,
  // max: background runs (/api/runs, Python, every account; user-approved 2026-11-18). A run that waits in
  // the request (/api/run: other languages, the Android app) is capped at SYNC_MAX_TIMEOUT_SEC.
  timeoutSec: { default: 60, min: 5, max: 3600 },
  maxCodeChars: 200_000,
  maxOutputChars: 200_000,
  maxPackages: 15,
  maxDomains: 20,
} as const;

/** A run that waits inside the request: Vercel ends a function at 300 s. */
export const SYNC_MAX_TIMEOUT_SEC = 240;
/** Background runs a user may have going at once (cost control). */
export const MAX_ACTIVE_RUNS = 3;

export const GPUS = ["T4", "L4", "A10G", "A100"] as const;
export type Gpu = (typeof GPUS)[number];

/**
 * What the sandbox may reach while the code runs: by default only DATASET_HOSTS (machine learning
 * datasets and pretrained weights; `# pip:` packages are installed into the image, not at run time),
 * nothing (`# network: off`), everything (`# network: on`), or only the domains a cell lists
 * (`# network: example.org, *.example.org`).
 */
export type Network = "datasets" | "off" | "on" | { domains: string[] };

/**
 * Where the common dataset loaders and pretrained weights download from (user-approved 2026-11-18:
 * datasets should just work): keras.datasets and Keras / TF weights, CIFAR, torchvision's MNIST and
 * Fashion-MNIST mirrors and PyTorch weights, scikit-learn's fetch_openml and its figshare-hosted
 * fetch_* (and figshare's S3 redirect), raw GitHub files (seaborn, statsmodels' R datasets, NLTK
 * data), GitHub release downloads, Hugging Face (datasets, transformers), UCI, Stanford NLP (GloVe,
 * IMDB) and Zenodo.
 */
export const DATASET_HOSTS = [
  // Keras / TensorFlow datasets and weights, TFDS
  "storage.googleapis.com",
  // CIFAR-10 / 100 (www.cs.toronto.edu redirects to cave.cs.toronto.edu)
  "www.cs.toronto.edu",
  "*.cs.toronto.edu",
  // torchvision's MNIST / Fashion-MNIST mirrors, and datasets kept on S3 (fast.ai, ...)
  "ossci-datasets.s3.amazonaws.com",
  "fashion-mnist.s3-website.eu-central-1.amazonaws.com",
  "s3.amazonaws.com",
  "*.s3.amazonaws.com",
  "s3-eu-west-1.amazonaws.com",
  "yann.lecun.com",
  // PyTorch / torchvision weights
  "download.pytorch.org",
  // scikit-learn: fetch_openml, and figshare (redirects to Cloudflare R2) for fetch_california_housing etc.
  "openml.org",
  "*.openml.org",
  "ndownloader.figshare.com",
  "*.figshare.com",
  "*.r2.cloudflarestorage.com",
  // GitHub: raw files (seaborn, statsmodels' R datasets, NLTK data) and release downloads
  "github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
  "*.githubusercontent.com",
  // Google Drive (gdown: CelebA and others)
  "drive.google.com",
  "drive.usercontent.google.com",
  // Hugging Face (datasets, transformers; files from its CDN)
  "huggingface.co",
  "*.huggingface.co",
  "*.hf.co",
  // UCI, Stanford (SVHN, STL-10, GloVe, IMDB), Zenodo
  "archive.ics.uci.edu",
  "*.stanford.edu",
  "zenodo.org",
  // R and Julia packages installed by the code itself (install.packages, Pkg.add)
  "cloud.r-project.org",
  "cran.r-project.org",
  "*.julialang.org",
] as const;

/** Whether a host is reachable by default (DATASET_HOSTS, with `*.` wildcards). */
export function isDatasetHost(host: string): boolean {
  const h = host.toLowerCase();
  return DATASET_HOSTS.some((d) => (d.startsWith("*.") ? h.endsWith(d.slice(1)) && h.length > d.length - 1 : h === d));
}

/**
 * The caller's own Hugging Face token (Settings; data_tokens() in the database) as the variable
 * huggingface_hub / datasets read; nothing when it isn't set.
 */
export function datasetEnv(t: unknown): Record<string, string> {
  const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
  return typeof o.hf_token === "string" && o.hf_token !== "" ? { HF_TOKEN: o.hf_token } : {};
}

export interface Directives {
  packages: string[];
  gpu: Gpu | null;
  /** How `gpu` was set: by the cell (`# gpu: T4`, `# gpu: none`), or "auto" (compute.ts decides). */
  gpuChoice: "cell" | "auto";
  timeoutSec: number;
  /** Whether the cell set `# timeout:`; if not, the run gets the most its account allows (run-prep.ts). */
  timeoutSet: boolean;
  network: Network;
  /**
   * Python: the cell's imports the image doesn't have (python-imports.ts), installed from PyPI with
   * the `# pip:` packages. If that layer won't build (a name that isn't on PyPI), the run goes ahead
   * without them and says so.
   */
  auto: string[];
}

const DOMAIN = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * The Modal Sandbox options for a run's network. `always`: hosts reachable whatever the cell says
 * (a background run's own app, to send its result back).
 */
export function sandboxNetwork(n: Network, always: readonly string[] = []): { blockNetwork: true } | { outboundDomainAllowlist: string[] } | Record<string, never> {
  if (n === "on") return {};
  if (n === "off") return always.length ? { outboundDomainAllowlist: [...always] } : { blockNetwork: true };
  const hosts = n === "datasets" ? DATASET_HOSTS : n.domains;
  return { outboundDomainAllowlist: [...new Set([...hosts, ...always])] };
}

const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([<>=!~]=?[A-Za-z0-9.*+!-]+)?$/;

export class DirectiveError extends Error {}

/**
 * Reads `pip:`, `gpu:`, `timeout:` and `network:` lines written as comments anywhere in the
 * code (`# pip: torch transformers`, `// timeout: 120`, `# network: on`). pip and gpu are Python only.
 * Throws DirectiveError with a short message when a value is not allowed.
 */
export function parseDirectives(language: ServerLanguageId, code: string): Directives {
  const token = languageConfig(language).comment ?? "#";
  const esc = token.replace(/[/]/g, "\\/");
  const re = new RegExp(`^\\s*${esc}\\s*(pip|gpu|timeout|network)\\s*:\\s*(.*)$`, "gim");
  const out: Directives = { packages: [], gpu: null, gpuChoice: "auto", timeoutSec: LIMITS.timeoutSec.default, timeoutSet: false, network: "datasets", auto: [] };
  for (const [, key, raw] of code.matchAll(re)) {
    const value = (raw ?? "").trim();
    const k = (key ?? "").toLowerCase();
    if ((k === "pip" || k === "gpu") && language !== "python") throw new DirectiveError(`${k}: is for Python only`);
    if (k === "pip") {
      for (const p of value.split(/[\s,]+/).filter(Boolean)) {
        if (!PACKAGE.test(p)) throw new DirectiveError(`Not a package name: ${p}`);
        out.packages.push(p);
      }
    } else if (k === "gpu") {
      const g = GPUS.find((x) => x.toLowerCase() === value.toLowerCase());
      const v = value.toLowerCase();
      if (["none", "cpu", "off", "no"].includes(v)) {
        out.gpu = null;
        out.gpuChoice = "cell";
      } else if (v === "auto") {
        out.gpu = null;
        out.gpuChoice = "auto";
      } else if (!g) {
        throw new DirectiveError(`gpu: must be auto, none or one of ${GPUS.join(", ")}`);
      } else {
        out.gpu = g;
        out.gpuChoice = "cell";
      }
    } else if (k === "network") {
      out.network = parseNetwork(value);
    } else {
      const n = Number(value.replace(/s$/i, ""));
      const { min, max } = LIMITS.timeoutSec;
      if (!Number.isInteger(n) || n < min || n > max) throw new DirectiveError(`timeout: must be ${min}–${max} seconds`);
      out.timeoutSec = n;
      out.timeoutSet = true;
    }
  }
  if (out.packages.length > LIMITS.maxPackages) throw new DirectiveError(`At most ${LIMITS.maxPackages} packages`);
  if (language === "python") out.auto = missingDistributions(code, out.packages, LIMITS.maxPackages - out.packages.length);
  return out;
}

function parseNetwork(value: string): Network {
  const v = value.toLowerCase();
  if (["on", "yes", "true", "all"].includes(v)) return "on";
  if (["off", "no", "false", "none"].includes(v)) return "off";
  if (["datasets", "default", ""].includes(v)) return "datasets";
  const domains = [...new Set(v.split(/[\s,]+/).filter(Boolean))];
  for (const d of domains) if (!DOMAIN.test(d)) throw new DirectiveError(`network: must be on, off, datasets or domain names (not ${d})`);
  if (domains.length > LIMITS.maxDomains) throw new DirectiveError(`network: at most ${LIMITS.maxDomains} domains`);
  return { domains };
}

/** Exit code of coreutils `timeout` when the time limit is hit. */
const TIMEOUT_EXIT = 124;

/** Where a run's files are written and its command runs. */
export const WORKDIR = "/tmp/bj";

/**
 * The files a run starts from, by path relative to WORKDIR: the code, and for Python
 * the capture module. They are written into the sandbox as files, so code of any
 * allowed size never passes through the command line or the environment.
 */
export function sourceFiles(language: ServerLanguageId, code: string, capture: string): Record<string, string> {
  const spec: ServerLanguage = SERVER_LANGUAGES[language];
  return { [spec.file]: code, ...(spec.capture ? { "bj_capture.py": capture } : {}), ...(spec.support ?? {}) };
}

/** Whether a language's runs come back with figures (it runs under bj_capture.py). */
export function capturesOutputs(language: ServerLanguageId): boolean {
  return (SERVER_LANGUAGES[language] as ServerLanguage).capture === true;
}

/**
 * The one shell command a run executes, after sourceFiles are in WORKDIR. `# pip:` packages
 * are already in the image (pythonImageLayers), so the time limit covers only the code.
 */
export function buildCommand(language: ServerLanguageId, d: Pick<Directives, "timeoutSec">): string[] {
  const body = SERVER_LANGUAGES[language].run;
  return ["sh", "-c", `cd ${WORKDIR} && exec timeout -s TERM ${d.timeoutSec}s sh -c '${body.replace(/'/g, `'\\''`)}'`];
}

const NETWORK_FAILURE = /Temporary failure in name resolution|Name or service not known|nodename nor servname|getaddrinfo|Network is unreachable|No route to host|Failed to establish a new network connection|urlopen error|Max retries exceeded with url|Could not resolve host|ConnectionError|ConnectTimeout/i;

/** The line added to stderr when a run failed trying to reach a site its network setting doesn't allow. */
export const NETWORK_HINT = "\n[Benchjot] Server code can reach the common dataset sites (Keras, PyTorch, OpenML, Hugging Face, GitHub, UCI, …) but not others. To download from another site, add `# network: on` (or `# network: <domains>`) to the cell.\n";
export const NETWORK_OFF_HINT = "\n[Benchjot] This cell turned the network off (`# network: off`). Remove that line to reach the common dataset sites, or use `# network: on`.\n";

/** stderr, with a hint added when the run failed reaching a site its network setting blocks. */
export function withNetworkHint(stderr: string, exitCode: number, network: Network): string {
  if (exitCode === 0 || network === "on" || !NETWORK_FAILURE.test(stderr)) return stderr;
  return stderr + (network === "off" ? NETWORK_OFF_HINT : NETWORK_HINT);
}

// Startup chatter the deep learning libraries print in C++ before Python can quiet them (TensorFlow
// ignores TF_CPP_MIN_LOG_LEVEL for these): absl's pre-init notice, its I/W-level log lines (oneDNN,
// XLA, cuDNN registration), and, on a run without a GPU, the failed CUDA probe. A Python traceback,
// print output and absl lines at E level other than the CUDA probe are never touched.
const ABSL_PREINIT = /^WARNING: All log messages before absl::InitializeLog\(\) is called are written to STDERR$/;
const ABSL_INFO = /^[IW]\d{4} [\d:.]+\s+\d+ [\w./-]+\.cc:\d+\] /;
const ABSL_CUDA_PROBE = /^E\d{4} [\d:.]+\s+\d+ (cuda_platform|cuda_executor|cuda_driver|gpu_device)\.cc:\d+\] .*(cuInit|CUDA|GPU)/;

/** stderr without the deep learning libraries' startup chatter (see above). */
export function quietLibraryLogs(stderr: string, gpu: boolean): string {
  if (!stderr) return stderr;
  return stderr
    .split("\n")
    .filter((line) => !ABSL_PREINIT.test(line) && !ABSL_INFO.test(line) && (gpu || !ABSL_CUDA_PROBE.test(line)))
    .join("\n");
}

/** The line on stderr when the cell's imports couldn't be installed from PyPI on the server. */
export function autoInstallNote(dists: readonly string[]): string {
  return `[Benchjot] Couldn't install ${dists.join(", ")} from PyPI on the server, so the code ran without ${dists.length > 1 ? "them" : "it"}. If an import's PyPI name differs from its module name, add it with # pip: <name>.\n`;
}

/**
 * Output as a terminal would leave it: a carriage return goes back to the start of the line, so of
 * a progress bar's hundreds of redraws (tqdm: downloads, training loops) only the last one stays.
 */
export function collapseCarriageReturns(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      const body = line.endsWith("\r") ? line.slice(0, -1) : line; // "\r\n" is just a line end
      const at = body.lastIndexOf("\r");
      return at === -1 ? body : body.slice(at + 1);
    })
    .join("\n");
}

/** Where each user's own download cache (a persistent volume) is mounted in a server run. */
export const CACHE_DIR = "/cache";

/** The cache volume's name for a user, or null for an id that isn't a UUID (never a path or another user's). */
export function cacheVolumeName(userId: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ? `bj-cache-${userId.toLowerCase()}` : null;
}

/**
 * Points every common loader's own cache at the user's cache volume, so what a run downloads once
 * (datasets, pretrained weights) is there on the next run: Hugging Face (datasets, transformers),
 * PyTorch hub and torchvision weights, scikit-learn's fetch_*, seaborn, NLTK, TensorFlow Datasets,
 * anything using the XDG cache, and torchvision dataset files (BJ_DOWNLOADS, kept by
 * bj_capture's download hook whatever folder the code asks for). Keras keeps its own cache in the
 * image (its datasets come from a fast host, and the slow ones are baked in).
 */
export function cacheEnv(dir: string = CACHE_DIR): Record<string, string> {
  return {
    HF_HOME: `${dir}/huggingface`,
    TORCH_HOME: `${dir}/torch`,
    SCIKIT_LEARN_DATA: `${dir}/scikit-learn`,
    SEABORN_DATA: `${dir}/seaborn`,
    NLTK_DATA: `${dir}/nltk`,
    TFDS_DATA_DIR: `${dir}/tfds`,
    XDG_CACHE_HOME: `${dir}/xdg`,
    BJ_DOWNLOADS: `${dir}/downloads`,
  };
}

/** What a finished run needs to turn its raw output into a ServerRunResponse. */
export interface RunMeta {
  language: ServerLanguageId;
  gpu: Gpu | null;
  network: Network;
  /** A line put first on stderr (the auto-install note). */
  note?: string;
}

/** A finished run's response from its raw output (the same for runs in the request and background runs). */
export function finishRun(meta: RunMeta, raw: string, stderr: string, exitCode: number, ms: number): ServerRunResponse {
  const python = meta.language === "python";
  const { stdout, outputs } = capturesOutputs(meta.language) ? splitBundle(raw) : { stdout: raw, outputs: null };
  return {
    outcome: outcomeOf(exitCode),
    outputs,
    stdout: capOutput(collapseCarriageReturns(stdout)),
    stderr: capOutput((meta.note ?? "") + withNetworkHint(collapseCarriageReturns(python ? quietLibraryLogs(stderr, meta.gpu !== null) : stderr), exitCode, meta.network)),
    exitCode,
    ms,
    line: exitCode === 0 ? null : serverErrorLine(meta.language, stderr),
  };
}

/** The user's line from a failed run's stderr, or null. */
export function serverErrorLine(language: ServerLanguageId, stderr: string): number | null {
  const { re, pick } = SERVER_LANGUAGES[language].line;
  const all = [...stderr.matchAll(new RegExp(re.source, "g"))];
  const m = pick === "first" ? all[0] : all[all.length - 1];
  return m ? Number(m[1] ?? m[2]) : null;
}

export type ServerOutcome = "ok" | "error" | "timeout";

export interface ServerRunResponse {
  outcome: ServerOutcome;
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
  line: number | null;
  /** A line about how the run was set up (where it ran, when chosen automatically), shown before its output. */
  notice?: string;
  /** Python only: bj_capture's manifest and files (base64), when the run made any. */
  outputs?: { manifest: unknown; files: Record<string, string> } | null;
}

/** Splits bj_capture's bundle off the end of stdout: the user's own output, and the outputs if any. */
export function splitBundle(stdout: string): { stdout: string; outputs: ServerRunResponse["outputs"] } {
  const at = stdout.lastIndexOf(BUNDLE_MARK);
  if (at === -1) return { stdout, outputs: null };
  try {
    const parsed = JSON.parse(stdout.slice(at + BUNDLE_MARK.length)) as NonNullable<ServerRunResponse["outputs"]>;
    return { stdout: stdout.slice(0, at), outputs: parsed && typeof parsed === "object" && "manifest" in parsed ? parsed : null };
  } catch {
    return { stdout: stdout.slice(0, at), outputs: null };
  }
}

export function outcomeOf(exitCode: number): ServerOutcome {
  return exitCode === 0 ? "ok" : exitCode === TIMEOUT_EXIT ? "timeout" : "error";
}

/** Keeps the tail of long output (the end is where errors are). */
export function capOutput(text: string, max: number = LIMITS.maxOutputChars): string {
  return text.length <= max ? text : `[output truncated]\n${text.slice(-max)}`;
}
