// Which of the user's datasets a cell uses: those whose file name its code mentions (in quotes, or in
// a path: 'iris.csv', "data/iris.csv"). They're placed in the run's working folder before it starts,
// so pd.read_csv("iris.csv") just works, in the browser, on the phone and on the server. Pure.

/** The most files placed in one run (each is downloaded before the code starts). */
export const DATA_PER_RUN = 8;
/** The private Storage bucket that holds each user's Data library, under a folder named by their id. */
export const DATA_BUCKET = "datasets";

/** The dataset names the code mentions, at most DATA_PER_RUN, longest name first (so "a.csv" doesn't shadow "data_a.csv"). */
export function datasetsIn(code: string, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (out.length >= DATA_PER_RUN) break;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|["'/\\\\\\s(])${esc}(?=$|["'\\s),])`).test(code)) out.push(name);
  }
  return out;
}

/** A name a dataset may have: a plain file name (letters, digits, - _ . and spaces), up to 120 characters, with an extension. */
export function validDataName(name: string): boolean {
  return /^[\w][\w .-]{0,118}\.[A-Za-z0-9]{1,10}$/.test(name) && !name.includes("..");
}

/** A file's name made valid: spaces kept, anything else odd becomes "_". */
export function cleanDataName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\w .-]/g, "_").replace(/^[^\w]+/, "").slice(-120);
  return clean;
}

/**
 * The library names a cell saves with save_data(...) (bj_capture): the quoted name it's given
 * (`name="x.h5"`, else the file's own name when it's a plain quoted path), valid names only, at
 * most DATA_PER_RUN. A server run gets an upload slot for each before it starts.
 */
export function savesIn(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/\bsave_data\(([^)]*)\)/g)) {
    const args = m[1] ?? "";
    const named = /\bname\s*=\s*["']([^"']+)["']/.exec(args);
    const first = /^\s*["']([^"']+)["']/.exec(args);
    const raw = named?.[1] ?? first?.[1];
    if (!raw) continue;
    const name = raw.split(/[\\/]/).pop() ?? "";
    if (validDataName(name)) out.add(name);
    if (out.size >= DATA_PER_RUN) break;
  }
  return [...out];
}
