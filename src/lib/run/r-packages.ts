// Which R packages a cell's code uses (library(x), require(x), requireNamespace("x"), x::f), so the
// browser can load them before the code runs. Pure; no imports.

/** Packages that are part of R itself: nothing to load. */
const BASE = new Set(["base", "stats", "graphics", "grDevices", "utils", "datasets", "methods", "grid", "splines", "stats4", "tools", "parallel", "compiler", "tcltk"]);

/** The add-on packages `code` names, in the order they first appear. Comments are ignored. */
export function rPackages(code: string): string[] {
  const text = code.replace(/#.*$/gm, "");
  const found = new Set<string>();
  const add = (name: string | undefined) => name && !BASE.has(name) && found.add(name);
  for (const m of text.matchAll(/\b(?:library|require|requireNamespace|loadNamespace)\s*\(\s*["']?([A-Za-z][A-Za-z0-9.]*)["']?/g)) add(m[1]);
  for (const m of text.matchAll(/(?<![A-Za-z0-9._])([A-Za-z][A-Za-z0-9.]*):::?[A-Za-z._]/g)) add(m[1]);
  return [...found];
}

/** R's own error text for the user: no internal file path or wrapper call; the line when R gives one. */
export function cleanRError(raw: string): { text: string; line: number | null } {
  const parse = /main\.R:(\d+):\d+:\s*([\s\S]*)$/.exec(raw);
  if (parse) return { text: `Error: ${parse[2]!.trimEnd()}`, line: Number(parse[1]) };
  // An error at the top level of the cell is "in eval(ei, envir)": that call is the runner's, not the user's.
  return { text: raw.replace(/^Error in eval\(ei, envir\): /, "Error: ").trimEnd(), line: null };
}
