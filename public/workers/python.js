// Python runner: Pyodide in a classic Web Worker. Loaded on the first Run and
// kept warm between runs; each run gets a fresh namespace. Static file (not
// bundled) so the Pyodide CDN script can be importScripts()-ed.
//
// A run is setup, then the user's code. Setup (Pyodide itself, the packages the code
// imports, and importing them: bj_preload.py) ends with { type: "start" }, where the
// time limit starts (src/lib/run/runner.ts); it reports { type: "status" } while it
// works and fails as { type: "error", setup: true, text } with a message for the user.
// The CDN files are cached by the browser (max-age 1 year).
//
// Code runs through bj_capture.py (next to this file, shared with the server
// and Android runners), which captures figures, tables and charts into
// /tmp/bj-out/<id>; they are posted back as { type: "outputs", manifest, files }.
//
// { id, render: { data, format, matplotlib } } makes a kept figure's SVG or PDF on
// Download (bj_capture.render_file), answered by { type: "rendered", data } or
// { type: "error", text, user }. It never touches a run's namespace.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/";
// Python modules served next to this file and importable from /bj. bj_packages decides what the
// code's imports need beyond Pyodide's own packages: PyPI (micropip) or the server.
const MODULES = ["bj_capture.py", "bj_preload.py", "bj_packages.py", "pypi-names.json"];
const LOADING_PACKAGES = "Loading Python packages…";
const OFFLINE_HINT = "Check your connection and run again.";
let ready = null;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

/** Sends the code's stdout / stderr to the page as { type: "out" }. */
function connectStreams(py, id) {
  py.setStdout({ batched: (s) => post({ id, type: "out", stream: "stdout", text: s + "\n" }) });
  py.setStderr({ batched: (s) => post({ id, type: "out", stream: "stderr", text: s + "\n" }) });
}

/** A setup failure whose message is for the user (shown as is, outside the time limit). */
class SetupError extends Error {}
/** Code the browser can't run (no browser build of a library it needs); the page may run it on the server. */
class NeedsServerError extends SetupError {}

function load(id) {
  if (!ready) {
    post({ id, type: "status", text: "Loading Python…" });
    try {
      importScripts(PYODIDE + "pyodide.js");
    } catch (e) {
      throw new SetupError(`Couldn't download Python. ${OFFLINE_HINT}\n${(e && e.message) || e}`);
    }
    ready = self.loadPyodide({ indexURL: PYODIDE }).then(async (py) => {
      py.FS.mkdirTree("/bj");
      for (const name of MODULES) py.FS.writeFile(`/bj/${name}`, await (await fetch(`/workers/${name}`, { cache: "no-cache" })).text());
      py.runPython("import sys\nif '/bj' not in sys.path: sys.path.insert(0, '/bj')");
      // Python's own downloads (urllib: seaborn.load_dataset, pandas.read_csv(url), statsmodels'
      // datasets) go through the browser's fetch; without this they fail with "unknown url type".
      try {
        await py.loadPackage("pyodide-http", { messageCallback: () => {} });
        py.runPython("import pyodide_http\npyodide_http.patch_all()");
      } catch (e) {
        console.warn("pyodide-http not loaded: URL downloads from Python won't work", e);
      }
      return py;
    });
    // A failed start isn't kept: the next run tries again.
    ready = ready.catch((e) => {
      ready = null;
      throw new SetupError(`Couldn't start Python. ${OFFLINE_HINT}\n${(e && e.message) || e}`);
    });
  }
  return ready;
}

/**
 * Everything the code needs before it runs: Pyodide's packages for its imports, then the rest
 * from PyPI (bj_packages.plan), then importing them (bj_preload). Code that needs a library with no
 * browser build (TensorFlow, PyTorch, ...) stops here with a SetupError pointing to Run on server.
 * Pyodide's loadPackage doesn't throw for a package it couldn't download (it logs "Failed to load
 * ..."): that is a SetupError too.
 */
async function prepare(py, id, code) {
  const failed = [];
  const details = [];
  await py.loadPackagesFromImports(code, {
    messageCallback: (m) => {
      if (/^Loading /.test(m)) post({ id, type: "status", text: LOADING_PACKAGES });
      const f = /^Failed to load (.+)$/.exec(m);
      if (f) failed.push(f[1]);
    },
    errorCallback: (m) => details.push(m),
  });
  if (failed.length) throw new SetupError(`Couldn't download Python packages (${failed.join(", ")}). ${OFFLINE_HINT}\n${details.join("\n")}`);
  await installFromPypi(py, id, code);
  const globals = py.toPy({ __bj_code: code });
  try {
    if (py.runPython("import bj_preload\nbool(bj_preload.pending(__bj_code))", { globals, filename: "<bj>" })) {
      post({ id, type: "status", text: LOADING_PACKAGES });
      // A library may need what its own imports name and nobody loaded: a module Pyodide ships as
      // its own package (mesa → sqlite3), distutils (gone in Python 3.13; setuptools has it), or a
      // dependency from PyPI (a package installed from its source has no dependency list). Load, retry.
      for (const tried = new Set(); ; ) {
        py.runPython("bj_preload.preload(__bj_code)", { globals, filename: "<bj>" });
        const more = py.runPython("import json\njson.dumps(bj_preload.missing())", { globals, filename: "<bj>" });
        const fresh = JSON.parse(more).filter((m) => !tried.has(m));
        if (!fresh.length) break;
        fresh.forEach((m) => tried.add(m));
        for (const m of fresh) await provide(py, id, m);
      }
    }
  } finally {
    globals.destroy();
  }
}

/** Makes module `m` importable (a library needed it): Pyodide's package, the distutils shim, or PyPI. */
async function provide(py, id, m) {
  if (m === "distutils") {
    await py.loadPackage("setuptools", { messageCallback: () => {} });
    py.runPython("import bj_preload\nbj_preload.shim_distutils()");
    return;
  }
  if (m === "_multiprocessing") {
    py.runPython("import bj_preload\nbj_preload.shim_multiprocessing()");
    return;
  }
  await py.loadPackagesFromImports(`import ${m}`, { messageCallback: () => {} });
  await installFromPypi(py, id, `import ${m}`);
}

/** What bj_packages.plan says the code's imports still need (after Pyodide's own packages are loaded). */
function packagePlan(py, code) {
  const globals = py.toPy({ __bj_code: code });
  try {
    return JSON.parse(py.runPython("import bj_packages, json\njson.dumps(bj_packages.plan(__bj_code))", { globals, filename: "<bj>" }));
  } finally {
    globals.destroy();
  }
}

/**
 * Installs the code's missing imports from PyPI (bj_packages.install: micropip, then an older
 * release that fits Pyodide's libraries, then a pure-Python source), one package at a time.
 * Throws NeedsServerError for a library that only runs on the server, or a package none of that
 * installs; a guarded import (`try: import x`) that can't be installed is left to the code.
 */
async function installFromPypi(py, id, code) {
  const plan = packagePlan(py, code);
  if (plan.blocked_downloads.length) {
    const globals = py.toPy({ __bj_loaders: plan.blocked_downloads });
    try {
      throw new NeedsServerError(py.runPython("import bj_packages\nbj_packages.blocked_downloads_message(list(__bj_loaders))", { globals, filename: "<bj>" }));
    } finally {
      globals.destroy();
    }
  }
  if (plan.server_only.length) {
    const globals = py.toPy({ __bj_labels: plan.server_only });
    try {
      throw new NeedsServerError(py.runPython("import bj_packages\nbj_packages.server_only_message(list(__bj_labels))", { globals, filename: "<bj>" }));
    } finally {
      globals.destroy();
    }
  }
  const wanted = [...plan.pypi, ...plan.optional];
  if (!wanted.length) return;
  post({ id, type: "status", text: LOADING_PACKAGES });
  try {
    await py.loadPackage(["micropip", "packaging"], { messageCallback: () => {} });
  } catch (e) {
    throw new SetupError(`Couldn't install Python packages from PyPI. ${OFFLINE_HINT}\n${(e && e.message) || e}`);
  }
  // micropip prints "Loading …" for each dependency: setup chatter, not the code's output.
  py.setStdout({ batched: () => {} });
  const cannot = [];
  let offline = false;
  try {
    for (const dist of wanted) {
      const globals = py.toPy({ __bj_dist: dist });
      let why;
      try {
        why = await py.runPythonAsync("import bj_packages\nawait bj_packages.install(__bj_dist)", { globals, filename: "<bj>" });
      } finally {
        globals.destroy();
      }
      if (!why || !plan.pypi.includes(dist)) continue; // installed, or a guarded import: the code has its own fallback
      if (why === "missing") offline = true;
      cannot.push(dist);
    }
  } finally {
    connectStreams(py, id);
  }
  if (!cannot.length) return;
  if (offline) throw new SetupError(`Couldn't install ${cannot.join(", ")} from PyPI. ${OFFLINE_HINT} (Check the name too: it has to be the package's PyPI name.)`);
  const globals = py.toPy({ __bj_dists: cannot });
  try {
    throw new NeedsServerError(py.runPython("import bj_packages\nbj_packages.cannot_install_message(list(__bj_dists))", { globals, filename: "<bj>" }));
  } finally {
    globals.destroy();
  }
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
  // What the code logged with log(), even when it drew nothing (experiment tracking).
  if (outputs && outputs.manifest.logged) post({ id, type: "logged", logged: outputs.manifest.logged });
  // Files the code passed to save_data(): their bytes, for the page to put in the Data library.
  const saved = [];
  for (const s of (outputs && outputs.manifest.saved) || []) {
    try {
      saved.push({ name: s.name, data: py.FS.readFile(s.path) });
    } catch {
      post({ id, type: "out", stream: "stderr", text: `Couldn't read ${s.name} to save it to your Data library.\n` });
    }
  }
  if (saved.length) post({ id, type: "saved", files: saved }, saved.map((f) => f.data.buffer));
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
    connectStreams(py, id);
    py.setStdin({ error: true });
    await prepare(py, id, code);
    // Datasets from the user's Data library that the code names: into the working folder first.
    for (const f of data.files ?? []) {
      post({ id, type: "status", text: `Getting ${f.name}…` });
      const res = await fetch(f.url);
      if (!res.ok) throw new SetupError(`Couldn’t get ${f.name} from your Data library. Try again.`);
      py.FS.writeFile(f.name, new Uint8Array(await res.arrayBuffer()));
    }
    post({ id, type: "start" });
    // Called when the user's code is done, before figures and GIFs are drawn: the time limit stops there.
    const globals = py.toPy({ __bj_code: code, __bj_dir: dir, __bj_done: () => post({ id, type: "capturing" }) });
    try {
      // The wrapper is "<bj>"; the user's code keeps the "<exec>" frames errors.ts reads.
      await py.runPythonAsync("import bj_capture\nawait bj_capture.run(__bj_code, __bj_dir, on_code_done=__bj_done)", { globals, filename: "<bj>" });
    } finally {
      globals.destroy();
    }
    postOutputs(py, id, dir);
    post({ id, type: "done" });
  } catch (e) {
    if (e instanceof SetupError) return post({ id, type: "error", setup: true, server: e instanceof NeedsServerError, text: e.message });
    if (py) postOutputs(py, id, dir);
    post({ id, type: "error", text: String((e && e.message) || e) });
  }
};
