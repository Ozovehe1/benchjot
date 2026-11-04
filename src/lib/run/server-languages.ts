// Server runs (Pro, on Modal): which languages, which image, how to build and
// run them, the limits, and the per-snippet directives read from comments.
// Pure data and string building, shared by the API route, the UI and the tests.
import { languageConfig } from "../languages";

export const IMAGES = {
  python: "python:3.12-slim",
  gcc: "gcc:14",
  go: "golang:1.23",
  rust: "rust:1-slim",
  java: "eclipse-temurin:21-jdk",
} as const;
export type ImageId = keyof typeof IMAGES;

/** Packages baked into the Python image so common research code needs no `# pip:` line. */
export const PYTHON_PREINSTALLED = ["numpy", "pandas", "scipy", "matplotlib", "seaborn", "scikit-learn", "pillow", "plotly", "altair", "bokeh"] as const;

/** Server runs return figures, tables and charts inline after this mark on stdout (bj_capture.BUNDLE_MARK). */
export const BUNDLE_MARK = "\n\u0000BJ-OUTPUTS\u0000";
/** Their total size, so the API answer stays under the hosting limit (about 4.5 MB). */
export const SERVER_OUTPUT_BYTES = 3 * 1024 * 1024;

interface ServerLanguage {
  image: ImageId;
  file: string;
  /** Shell that compiles (if needed) and runs `file` from the working directory. */
  run: string;
  /** Finds the user's line in stderr; `last` for tracebacks, `first` for compilers. */
  line: { re: RegExp; pick: "first" | "last" };
}

const firstAt = (file: string) => ({ re: new RegExp(`${file.replace(".", "\\.")}:(\\d+)`, "g"), pick: "first" as const });

export const SERVER_LANGUAGES = {
  // Through bj_capture.py (written next to main.py), which captures figures, tables and charts.
  python: { image: "python", file: "main.py", run: "python3 -u bj_capture.py main.py out", line: { re: /File "(?:[^"]*\/)?main\.py", line (\d+)/g, pick: "last" } },
  c: { image: "gcc", file: "main.c", run: "gcc -O2 -std=c17 -o main main.c -lm && ./main", line: firstAt("main.c") },
  cpp: { image: "gcc", file: "main.cpp", run: "g++ -O2 -std=c++20 -o main main.cpp && ./main", line: firstAt("main.cpp") },
  go: { image: "go", file: "main.go", run: "go run main.go", line: firstAt("main.go") },
  rust: { image: "rust", file: "main.rs", run: "rustc -O -o main main.rs && ./main", line: firstAt("main.rs") },
  java: { image: "java", file: "Main.java", run: "java Main.java", line: firstAt("Main.java") },
} as const satisfies Record<string, ServerLanguage>;
export type ServerLanguageId = keyof typeof SERVER_LANGUAGES;

export function runsOnServer(language: string): language is ServerLanguageId {
  return Object.hasOwn(SERVER_LANGUAGES, language);
}

export const LIMITS = {
  cpu: 2,
  memoryMiB: 2048,
  memoryLimitMiB: 4096,
  gpuMemoryLimitMiB: 16384,
  timeoutSec: { default: 60, min: 5, max: 240 }, // the API route itself may live 300 s
  maxCodeChars: 200_000,
  maxOutputChars: 200_000,
  maxPackages: 15,
} as const;

export const GPUS = ["T4", "L4", "A10G", "A100"] as const;
export type Gpu = (typeof GPUS)[number];

export interface Directives {
  packages: string[];
  gpu: Gpu | null;
  timeoutSec: number;
}

const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([<>=!~]=?[A-Za-z0-9.*+!-]+)?$/;

export class DirectiveError extends Error {}

/**
 * Reads `pip:`, `gpu:` and `timeout:` lines written as comments anywhere in the
 * code (`# pip: torch transformers`, `// timeout: 120`). pip and gpu are Python only.
 * Throws DirectiveError with a short message when a value is not allowed.
 */
export function parseDirectives(language: ServerLanguageId, code: string): Directives {
  const token = languageConfig(language).comment ?? "#";
  const esc = token.replace(/[/]/g, "\\/");
  const re = new RegExp(`^\\s*${esc}\\s*(pip|gpu|timeout)\\s*:\\s*(.*)$`, "gim");
  const out: Directives = { packages: [], gpu: null, timeoutSec: LIMITS.timeoutSec.default };
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
      if (!g) throw new DirectiveError(`gpu: must be one of ${GPUS.join(", ")}`);
      out.gpu = g;
    } else {
      const n = Number(value.replace(/s$/i, ""));
      const { min, max } = LIMITS.timeoutSec;
      if (!Number.isInteger(n) || n < min || n > max) throw new DirectiveError(`timeout: must be ${min}–${max} seconds`);
      out.timeoutSec = n;
    }
  }
  if (out.packages.length > LIMITS.maxPackages) throw new DirectiveError(`At most ${LIMITS.maxPackages} packages`);
  return out;
}

/** Exit code of coreutils `timeout` when the time limit is hit. */
export const TIMEOUT_EXIT = 124;

/**
 * The one shell command a sandbox runs. The code arrives in $BJ_CODE (never
 * interpolated), packages are validated by parseDirectives, so nothing user
 * supplied is spliced into the shell unquoted.
 */
export function buildCommand(language: ServerLanguageId, d: Directives): string[] {
  const spec = SERVER_LANGUAGES[language];
  const pip = d.packages.length
    ? `pip install -q --disable-pip-version-check --root-user-action=ignore ${d.packages.map((p) => `'${p}'`).join(" ")} 1>&2 && `
    : "";
  const body = `${pip}${spec.run}`;
  const capture = language === "python" ? `printf '%s' "$BJ_CAPTURE" > bj_capture.py && ` : "";
  const script = `mkdir -p /tmp/bj && cd /tmp/bj && printf '%s' "$BJ_CODE" > ${spec.file} && ${capture}exec timeout -s TERM ${d.timeoutSec}s sh -c '${body.replace(/'/g, `'\\''`)}'`;
  return ["sh", "-c", script];
}

/** The user's line from a failed run's stderr, or null. */
export function serverErrorLine(language: ServerLanguageId, stderr: string): number | null {
  const { re, pick } = SERVER_LANGUAGES[language].line;
  const all = [...stderr.matchAll(new RegExp(re.source, "g"))];
  const m = pick === "first" ? all[0] : all[all.length - 1];
  return m ? Number(m[1]) : null;
}

export type ServerOutcome = "ok" | "error" | "timeout";

export interface ServerRunResponse {
  outcome: ServerOutcome;
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
  line: number | null;
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
