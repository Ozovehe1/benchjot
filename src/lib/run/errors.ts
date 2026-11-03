// Pure helpers that turn runtime errors into something short and point at a line.

/** Line of the user's code in a Python traceback (the last frame in "<exec>"), or null. */
export function pythonErrorLine(traceback: string): number | null {
  const lines = [...traceback.matchAll(/File "<exec>", line (\d+)/g)];
  const last = lines[lines.length - 1];
  return last ? Number(last[1]) : null;
}

/**
 * Pyodide tracebacks start with its own internal frames; keep only the
 * "Traceback" header plus the frames from the user's code onwards.
 */
export function cleanPythonTraceback(traceback: string): string {
  const text = traceback.trimEnd();
  const first = text.indexOf('File "<exec>"');
  if (first === -1) return text;
  const start = text.lastIndexOf("\n", first);
  return `Traceback (most recent call last):\n${text.slice(start + 1)}`;
}

/** Line in the user's JS/TS from a stack trace of code run as "snippet.js" wrapped with `offset` extra lines on top. */
export function jsErrorLine(stack: string, offset = 1): number | null {
  const m = /snippet\.js:(\d+):\d+/.exec(stack);
  if (!m) return null;
  const line = Number(m[1]) - offset;
  return line >= 1 ? line : null;
}
