// Server runs: a Python cell's imports that the server image doesn't have, so they are
// installed from PyPI without a `# pip:` line (a cached image layer, like `# pip:`). Pure.
// Import names map to PyPI names through public/workers/pypi-names.json, shared with the browser.
import pypiNames from "../../../public/workers/pypi-names.json";
import image from "./python-image.json";
import stdlib from "./python-stdlib.json";

const norm = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
const STDLIB = new Set<string>(stdlib);
const INSTALLED = new Set<string>(image.installed);
const NAMES: Record<string, string> = pypiNames;
/** Distributions that provide the same import under another name (the image has OpenCV headless). */
const SAME_IMPORT: Record<string, string[]> = {
  "opencv-python": ["opencv-python-headless", "opencv-contrib-python", "opencv-contrib-python-headless"],
  "pillow": ["pillow-simd"],
  "tensorflow": ["tensorflow-cpu", "tf-nightly"],
};
const installed = (dist: string) => [norm(dist), ...(SAME_IMPORT[norm(dist)] ?? [])].some((d) => INSTALLED.has(d));

/** Whether a top-level module is Python's own (the standard library). */
export const isStdlib = (module: string) => STDLIB.has(module);

/** The top-level modules a cell imports (`import a.b as c, d` → a, d; `from e.f import g` → e), in order; relative imports are skipped. */
export function topLevelImports(code: string): string[] {
  const found: string[] = [];
  const add = (name: string) => {
    const top = name.trim().split(".")[0] ?? "";
    if (/^[A-Za-z_]\w*$/.test(top) && !found.includes(top)) found.push(top);
  };
  for (const raw of code.split("\n")) {
    const line = raw.replace(/#.*$/, "");
    for (const stmt of line.split(";")) {
      const imp = /^\s*import\s+(.+)$/.exec(stmt);
      if (imp) for (const part of imp[1]!.split(",")) add(part.trim().split(/\s+as\s+/)[0] ?? "");
      const from = /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/.exec(stmt);
      if (from) add(from[1]!);
    }
  }
  return found;
}

/** The PyPI distribution an import name comes from. */
export function distributionFor(importName: string): string {
  return NAMES[importName] ?? importName;
}

/**
 * Distributions to install for the cell's imports that are neither standard library nor in the
 * image, nor already asked for with `# pip:`; at most `max`.
 */
export function missingDistributions(code: string, explicit: readonly string[] = [], max = Infinity): string[] {
  const asked = new Set(explicit.map((p) => norm(p.replace(/[[<>=!~;].*$/, ""))));
  const out: string[] = [];
  for (const name of topLevelImports(code)) {
    if (STDLIB.has(name) || name.startsWith("_")) continue;
    const dist = distributionFor(name);
    if (installed(dist) || asked.has(norm(dist)) || out.includes(dist)) continue;
    out.push(dist);
  }
  return out.slice(0, max);
}

/**
 * What Python has on every device (the browser, and the phone: the Android app's built-in set),
 * besides its standard library. IPython is here too: its display objects work everywhere
 * (bj_capture stands in for it where it isn't installed).
 */
export const DEVICE_PYTHON = new Set(["numpy", "pandas", "scipy", "sklearn", "matplotlib", "mpl_toolkits", "seaborn", "PIL", "plotly", "altair", "bokeh", "IPython"]);

/** The libraries a Python cell imports that only the server has (PyTorch, XGBoost, transformers, …). */
export function serverOnlyImports(code: string): string[] {
  return topLevelImports(code).filter((m) => !isStdlib(m) && !DEVICE_PYTHON.has(m));
}

/**
 * The library a device run failed for lack of, when the server has it: an import the code's own text
 * doesn't show (pandas' to_excel needs openpyxl), so it wasn't sent to the server up front. Null for
 * any other error, and for the device's own libraries (a missing piece of those is a real error).
 */
export function missingOnDevice(errorText: string | null | undefined): string | null {
  const m = /ModuleNotFoundError: No module named '([\w.]+)'/.exec(errorText ?? "");
  const top = m?.[1]?.split(".")[0];
  return top && !DEVICE_PYTHON.has(top) && !isStdlib(top) ? top : null;
}
