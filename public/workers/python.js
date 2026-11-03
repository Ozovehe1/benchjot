// Python runner: Pyodide in a classic Web Worker. Loaded on the first Run and
// kept warm between runs; each run gets a fresh namespace. Static file (not
// bundled) so the Pyodide CDN script can be importScripts()-ed.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/";
let ready = null;

function post(msg) {
  self.postMessage(msg);
}

function load(id) {
  if (!ready) {
    post({ id, type: "status", text: "Loading Python…" });
    importScripts(PYODIDE + "pyodide.js");
    ready = self.loadPyodide({ indexURL: PYODIDE });
  }
  return ready;
}

self.onmessage = async ({ data }) => {
  const { id, code } = data;
  try {
    const py = await load(id);
    py.setStdout({ batched: (s) => post({ id, type: "out", stream: "stdout", text: s + "\n" }) });
    py.setStderr({ batched: (s) => post({ id, type: "out", stream: "stderr", text: s + "\n" }) });
    py.setStdin({ error: true });
    await py.loadPackagesFromImports(code, {
      messageCallback: (m) => /^Loading /.test(m) && post({ id, type: "status", text: m }),
      errorCallback: (m) => post({ id, type: "out", stream: "stderr", text: m + "\n" }),
    });
    post({ id, type: "start" });
    const globals = py.toPy({ __name__: "__main__" });
    try {
      await py.runPythonAsync(code, { globals, filename: "<exec>" });
    } finally {
      globals.destroy();
    }
    post({ id, type: "done" });
  } catch (e) {
    post({ id, type: "error", text: String((e && e.message) || e) });
  }
};
