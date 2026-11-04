// Python runner: Pyodide in a classic Web Worker. Loaded on the first Run and
// kept warm between runs; each run gets a fresh namespace. Static file (not
// bundled) so the Pyodide CDN script can be importScripts()-ed.
//
// Code runs through bj_capture.py (next to this file, shared with the server
// and Android runners), which captures figures, tables and charts into
// /tmp/bj-out/<id>; they are posted back as { type: "outputs", manifest, files }.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/";
// Pure-Python libraries Pyodide doesn't ship, installed from PyPI on first import.
const FROM_PYPI = { plotly: "plotly", seaborn: "seaborn" };
let ready = null;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

function load(id) {
  if (!ready) {
    post({ id, type: "status", text: "Loading Python…" });
    importScripts(PYODIDE + "pyodide.js");
    ready = self.loadPyodide({ indexURL: PYODIDE }).then(async (py) => {
      const src = await (await fetch("/workers/bj_capture.py", { cache: "no-cache" })).text();
      py.FS.mkdirTree("/bj");
      py.FS.writeFile("/bj/bj_capture.py", src);
      py.runPython("import sys\nif '/bj' not in sys.path: sys.path.insert(0, '/bj')");
      return py;
    });
  }
  return ready;
}

async function installFromPypi(py, id, code) {
  const imports = py.pyodide_py.code.find_imports(code).toJs();
  const missing = (p) => !py.runPython(`__import__("importlib.util").util.find_spec(${JSON.stringify(p)}) is not None`);
  const wanted = [...new Set(imports.map((m) => FROM_PYPI[m]).filter(Boolean))].filter(missing);
  if (!wanted.length) return;
  post({ id, type: "status", text: `Loading ${wanted.join(", ")}…` });
  await py.loadPackage("micropip", { messageCallback: () => {} });
  await py.pyimport("micropip").install(wanted);
}

/** Reads the manifest and files bj_capture wrote, then removes them. */
function collect(py, dir) {
  try {
    const manifest = JSON.parse(py.FS.readFile(`${dir}/manifest.json`, { encoding: "utf8" }));
    const files = {};
    for (const item of manifest.items) for (const name of Object.values(item.files)) files[name] = py.FS.readFile(`${dir}/${name}`);
    return { manifest, files };
  } catch {
    return null;
  } finally {
    py.runPython(`import shutil; shutil.rmtree(${JSON.stringify(dir)}, ignore_errors=True)`);
  }
}

function postOutputs(py, id, dir) {
  const outputs = collect(py, dir);
  if (outputs && outputs.manifest.items.length) {
    post({ id, type: "outputs", outputs }, Object.values(outputs.files).map((f) => f.buffer));
  }
}

self.onmessage = async ({ data }) => {
  const { id, code } = data;
  let py = null;
  const dir = `/tmp/bj-out/${id}`;
  try {
    py = await load(id);
    py.setStdout({ batched: (s) => post({ id, type: "out", stream: "stdout", text: s + "\n" }) });
    py.setStderr({ batched: (s) => post({ id, type: "out", stream: "stderr", text: s + "\n" }) });
    py.setStdin({ error: true });
    await py.loadPackagesFromImports(code, {
      messageCallback: (m) => /^Loading /.test(m) && post({ id, type: "status", text: m }),
      errorCallback: (m) => post({ id, type: "out", stream: "stderr", text: m + "\n" }),
    });
    await installFromPypi(py, id, code);
    post({ id, type: "start" });
    const globals = py.toPy({ __bj_code: code, __bj_dir: dir });
    try {
      // The wrapper is "<bj>"; the user's code keeps the "<exec>" frames errors.ts reads.
      await py.runPythonAsync("import bj_capture\nawait bj_capture.run(__bj_code, __bj_dir)", { globals, filename: "<bj>" });
    } finally {
      globals.destroy();
    }
    postOutputs(py, id, dir);
    post({ id, type: "done" });
  } catch (e) {
    if (py) postOutputs(py, id, dir);
    post({ id, type: "error", text: String((e && e.message) || e) });
  }
};
