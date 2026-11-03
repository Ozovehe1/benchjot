// JS runner: user code (already plain JS) in a Web Worker with network and
// storage APIs removed. A fresh worker is used for every run.
const post = (msg) => self.postMessage(msg);

function blocked(name) {
  return function () {
    throw new Error(name + " is not available when running here");
  };
}

for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel"]) {
  const value = blocked(name);
  for (const target of [self, Object.getPrototypeOf(self), typeof WorkerGlobalScope !== "undefined" ? WorkerGlobalScope.prototype : null]) {
    if (!target) continue;
    try {
      Object.defineProperty(target, name, { get: () => value, configurable: false });
    } catch {}
  }
}

function show(v) {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || String(v);
  try {
    const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() + "n" : x));
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

let current = 0;
const line = (stream) => (...args) => post({ id: current, type: "out", stream, text: args.map(show).join(" ") + "\n" });
console.log = console.info = console.debug = line("stdout");
console.warn = console.error = line("stderr");

self.onmessage = async ({ data }) => {
  current = data.id;
  post({ id: current, type: "start" });
  try {
    // One wrapper line on top (offset 1) so top-level await works.
    await (0, eval)("(async () => {\n" + data.code + "\n})()\n//# sourceURL=snippet.js");
    post({ id: current, type: "done" });
  } catch (e) {
    post({ id: current, type: "error", text: (e && e.stack) || String(e) });
  }
};
self.addEventListener("unhandledrejection", (e) => post({ id: current, type: "out", stream: "stderr", text: show(e.reason) + "\n" }));
