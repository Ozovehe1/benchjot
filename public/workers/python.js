// Python runner: Pyodide in a classic Web Worker. Loaded on the first Run and
// kept warm between runs; each run gets a fresh namespace. Static file (not
// bundled) so the Pyodide CDN script can be importScripts()-ed.
//
// Code runs through bj_capture.py (next to this file, shared with the server
// and Android runners), which captures figures, tables and charts into
// /tmp/bj-out/<id>; they are posted back as { type: "outputs", manifest, files }.
//
// { id, render: { data, format, matplotlib } } makes a kept figure's SVG or PDF on
// Download (bj_capture.render_file), answered by { type: "rendered", data } or
// { type: "error", text, user }. It never touches a run's namespace.
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

/** The message of a bj_capture.RenderError (meant for the user), or null for any other failure. */
function renderErrorText(e) {
  const last = String((e && e.message) || e).trim().split("\n").pop() || "";
  return last.startsWith("bj_capture.RenderError: ") ? last.slice("bj_capture.RenderError: ".length) : null;
}

/** The top-level module a ModuleNotFoundError names, or null. */
function missingModule(e) {
  // Pyodide adds lines after the message ("The module 'x' is included in the Pyodide distribution...").
  const m = [...String((e && e.message) || e).matchAll(/^ModuleNotFoundError: No module named '([\w.]+)'/gm)].pop();
  return m ? m[1].split(".")[0] : null;
}

async function render(id, { data, format, matplotlib }) {
  const src = `/tmp/bj-fig-${id}.mpl`;
  const dest = `/tmp/bj-fig-${id}.${format}`;
  try {
    const py = await load(id);
    await py.loadPackage("matplotlib", { messageCallback: () => {} });
    py.FS.writeFile(src, data);
    const globals = py.toPy({ __bj_src: src, __bj_format: format, __bj_dest: dest, __bj_made: matplotlib ?? null });
    try {
      // A figure can refer to a library loaded on demand (pandas' date axes): load it and try again.
      for (const tried = new Set(); ; ) {
        try {
          py.runPython("import bj_capture\nbj_capture.render_file(__bj_src, __bj_format, __bj_dest, __bj_made)", { globals, filename: "<bj>" });
          break;
        } catch (e) {
          const mod = missingModule(e);
          if (!mod || tried.has(mod)) throw e;
          tried.add(mod);
          await py.loadPackagesFromImports(`import ${mod}`, { messageCallback: () => {} });
          await installFromPypi(py, id, `import ${mod}`);
        }
      }
    } finally {
      globals.destroy();
    }
    const out = py.FS.readFile(dest);
    post({ id, type: "rendered", data: out }, [out.buffer]);
  } catch (e) {
    post({ id, type: "error", text: String((e && e.message) || e), user: renderErrorText(e) });
  } finally {
    const py = ready && (await ready.catch(() => null));
    if (py) for (const p of [src, dest]) if (py.FS.analyzePath(p).exists) py.FS.unlink(p);
  }
}

self.onmessage = async ({ data }) => {
  if (data.render) return render(data.id, data.render);
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
