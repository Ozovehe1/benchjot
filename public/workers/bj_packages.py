"""Which of a cell's imports the browser can't provide, and what to do about them (web Pyodide worker only).

python.js first loads the packages Pyodide ships for the code's imports (numpy, pandas, scipy,
scikit-learn, statsmodels, xgboost, lightgbm, sympy, networkx, scikit-image, OpenCV, astropy, ...).
For the imports still missing after that, plan() says:

* ``server_only``: libraries that can't run in a browser at all (no WebAssembly build: TensorFlow,
  Keras 3, PyTorch, JAX, ...). The run stops before its clock starts with server_only_message(),
  which points to Run on server, where they are preinstalled.
* ``pypi``: anything else, installed from PyPI by install(): micropip first; when the newest release
  needs newer libraries than Pyodide ships (mlxtend wants scikit-learn 1.8), the newest older release
  that fits; when a package has no wheel at all but its source is pure Python (lime), its source.
  A package none of that installs has compiled code with no browser build: python.js stops the run
  as needing the server (Run goes on to the server by itself).

An import inside a ``try`` block is the code's own fallback (``try: import ujson except ImportError``),
so it never stops the run.
"""

import ast
import importlib.util
import io
import json
import os
import re
import sys
import tarfile
import zipfile

# Import name -> what to call it. These have native code with no Pyodide build.
SERVER_ONLY = {
    "tensorflow": "TensorFlow",
    "tensorflow_hub": "TensorFlow Hub",
    "tensorflow_datasets": "TensorFlow Datasets",
    "keras": "Keras",
    "tf_keras": "Keras",
    "torch": "PyTorch",
    "torchvision": "torchvision",
    "torchaudio": "torchaudio",
    "jax": "JAX",
    "jaxlib": "JAX",
    "flax": "Flax",
    "transformers": "Transformers",
    "catboost": "CatBoost",
    "numba": "Numba",
    "pymc": "PyMC",
    "cupy": "CuPy",
    "polars": "Polars",
    "onnxruntime": "ONNX Runtime",
    # Found by trying them in Pyodide 0.29 (compiled code, or Numba / Stan underneath).
    "shap": "SHAP",
    "pmdarima": "pmdarima",
    "prophet": "Prophet",
    "statsforecast": "StatsForecast",
    "tslearn": "tslearn",
    "umap": "UMAP",
    "gensim": "Gensim",  # installs, then fails on Pyodide's SciPy
    "hdbscan": "HDBSCAN",
    "spacy": "spaCy",
    "duckdb": "DuckDB",
    "datasets": "Hugging Face Datasets",
}

# Import name -> PyPI distribution, where they differ (the rest install under their import name).
# Shared with the server's import check (src/lib/run/python-imports.ts) through pypi-names.json.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pypi-names.json"), encoding="utf-8") as _f:
    PYPI_NAMES = json.load(_f)


_TRY = tuple(t for t in (getattr(ast, "Try", None), getattr(ast, "TryStar", None)) if t)


def _imports(code):
    """(top-level module, guarded) for each absolute import, in order; [] for code that doesn't parse."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return []
    guarded = set()
    for node in ast.walk(tree):
        if isinstance(node, _TRY):
            for stmt in node.body:
                for inner in ast.walk(stmt):
                    guarded.add(id(inner))
    found = {}
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        for n in names:
            top = n.split(".")[0]
            # Unguarded anywhere wins: the code needs it.
            found[top] = found.get(top, True) and id(node) in guarded
    return list(found.items())


def _available(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


# Dataset loaders whose hosts refuse downloads from a web page (no CORS), so they can't work in the
# browser: found by trying them in Pyodide (2026-11-18). seaborn.load_dataset, statsmodels'
# get_rdataset, pandas.read_csv(url) and requests do work there (python.js patches urllib).
BROWSER_BLOCKED_LOADERS = {
    "fetch_openml": "OpenML",
    "fetch_california_housing": "figshare",
    "fetch_covtype": "figshare",
    "fetch_kddcup99": "figshare",
    "fetch_rcv1": "figshare",
    "fetch_20newsgroups": "figshare",
    "fetch_20newsgroups_vectorized": "figshare",
    "fetch_lfw_people": "figshare",
    "fetch_lfw_pairs": "figshare",
    "fetch_olivetti_faces": "figshare",
    "fetch_species_distributions": "figshare",
}


def blocked_downloads(code):
    """The loaders in `code` whose download a browser can't make (calls or imports of them), in order."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return []
    found = []
    for node in ast.walk(tree):
        name = None
        if isinstance(node, ast.Attribute):
            name = node.attr
        elif isinstance(node, ast.Name):
            name = node.id
        elif isinstance(node, ast.alias):
            name = node.name.rsplit(".", 1)[-1]
        if name in BROWSER_BLOCKED_LOADERS and name not in found:
            found.append(name)
    return found


def blocked_downloads_message(loaders):
    """The setup error for code that downloads from a site that refuses browsers."""
    names = ", ".join(loaders)
    return (
        f"{names} downloads from a site that doesn't allow downloads from a browser. "
        "Use Run on server: common dataset sites are reachable there."
    )


def plan(code):
    """{"server_only": [display names], "pypi": [distributions], "optional": [distributions],
    "blocked_downloads": [loaders]} for the imports not available now and the downloads a browser
    can't make. ``optional`` are guarded imports worth trying (failures are silent)."""
    server_only, pypi, optional = [], [], []
    for top, guarded in _imports(code):
        if top in sys.stdlib_module_names or _available(top):
            continue
        if top in SERVER_ONLY:
            label = SERVER_ONLY[top]
            if not guarded and label not in server_only:
                server_only.append(label)
            continue
        dist = PYPI_NAMES.get(top, top)
        target = optional if guarded else pypi
        if dist not in pypi and dist not in optional:
            target.append(dist)
    return {"server_only": server_only, "pypi": pypi, "optional": optional, "blocked_downloads": blocked_downloads(code)}


def server_only_message(labels):
    """The setup error for code that needs a library the browser can't run."""
    names = ", ".join(labels[:-1]) + (" and " if len(labels) > 1 else "") + labels[-1]
    verb = "don't" if len(labels) > 1 else "doesn't"
    return (
        f"{names} {verb} run in the browser (no WebAssembly build). "
        "Use Run on server: the deep learning and data science stack is preinstalled there "
        "(with GPUs: # gpu: T4), and any other package installs from PyPI."
    )


# --------------------------------------------------------------------------- install()
MAX_OLDER = 12  # older releases tried when the newest needs newer libraries than Pyodide has
COMPILED = (".c", ".cc", ".cpp", ".cxx", ".pyx", ".f", ".f90", ".for", ".cu", ".rs", ".swg")
PURE_WHEEL = ("-py3-none-any.whl", "-py2.py3-none-any.whl")
# How micropip says a requirement can't be met: no browser wheel for it, or another version is loaded.
_NO_WHEEL = re.compile(r"Can't find a pure Python 3 wheel for '([^']+)'|Requested '([^']+)', but \S+ is already installed")


def _norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def dependency_conflict(message, dist):
    """The requirement micropip couldn't meet when it is another package's version (so an older
    release of `dist` may fit), else None (`dist` itself has no browser wheel, or another failure)."""
    m = _NO_WHEEL.search(message)
    if not m:
        return None
    req = m.group(1) or m.group(2)
    name = re.split(r"[\s<>=!~;\[(]", req, maxsplit=1)[0]
    return None if _norm(name) == _norm(dist) else req


def older_versions(info, limit=MAX_OLDER):
    """Final releases older than the newest with a pure-Python wheel, newest first (PyPI JSON)."""
    from packaging.version import InvalidVersion, Version

    newest = info["info"]["version"]
    found = []
    for v, files in info.get("releases", {}).items():
        try:
            pv = Version(v)
        except InvalidVersion:
            continue
        if v == newest or pv.is_prerelease or pv.is_devrelease:
            continue
        if any(f["filename"].endswith(PURE_WHEEL) and not f.get("yanked") for f in files):
            found.append(pv)
    return [str(v) for v in sorted(found, reverse=True)[:limit]]


def sdist_file(info):
    """The newest release's source archive when it has no wheel micropip could use, else None."""
    files = info.get("urls", [])
    if any(f["filename"].endswith(".whl") for f in files):
        return None
    for f in files:
        if f.get("packagetype") == "sdist" and not f.get("yanked") and f["filename"].endswith((".tar.gz", ".zip")):
            return f
    return None


def _members(data, filename):
    """(path, bytes) for each regular file in a .tar.gz or .zip."""
    if filename.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for i in z.infolist():
                if not i.is_dir():
                    yield i.filename, z.read(i)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
            for m in t.getmembers():
                if m.isfile():
                    yield m.name, t.extractfile(m).read()


_SKIP_TOP = {"setup", "conftest", "test", "tests", "doc", "docs", "example", "examples", "benchmarks", "build", "dist"}


def pure_sdist_files(data, filename):
    """{path inside site-packages: bytes} for a pure-Python source archive's packages and modules,
    or None when it holds compiled sources (they need a build the browser can't do)."""
    files = dict(_members(data, filename))
    if any(p.lower().endswith(COMPILED) for p in files):
        return None
    roots = {p.split("/", 1)[0] for p in files}
    if len(roots) != 1:
        return None
    root = roots.pop() + "/"
    base = root + "src/" if any(p.startswith(root + "src/") and p.endswith("/__init__.py") for p in files) else root
    out = {}
    packages = {p[len(base):].split("/", 1)[0] for p in files if p.startswith(base) and p[len(base):].count("/") == 1 and p.endswith("/__init__.py")}
    for p, b in files.items():
        if not p.startswith(base):
            continue
        rel = p[len(base):]
        top = rel.split("/", 1)[0]
        is_module = "/" not in rel and rel.endswith(".py") and rel[:-3] not in _SKIP_TOP
        if (top in packages and top not in _SKIP_TOP) or is_module:
            parts = rel.split("/")
            if any(x in ("", ".", "..") for x in parts) or rel.startswith("/"):
                return None
            out[rel] = b
    return out or None


def _site_packages():
    import site

    return next(p for p in site.getsitepackages() if p.endswith("site-packages"))


async def _pypi_json(dist):
    from pyodide.http import pyfetch

    r = await pyfetch(f"https://pypi.org/pypi/{dist}/json")
    return (await r.json()) if r.ok else None


async def install(dist):
    """Installs `dist` in the browser; returns "" when it is installed, else why not: "compiled"
    (no browser build) or "missing" (not on PyPI, or the network failed)."""
    import micropip

    try:
        await micropip.install(dist)
        return ""
    except Exception as e:  # noqa: BLE001 (micropip raises ValueError and others)
        message = str(e)
    try:
        info = await _pypi_json(dist)
    except Exception:  # noqa: BLE001
        info = None
    if info is None:
        return "missing"
    if dependency_conflict(message, dist):
        for v in older_versions(info):
            try:
                await micropip.install(f"{dist}=={v}")
                return ""
            except Exception:  # noqa: BLE001
                continue
        return "compiled"
    f = sdist_file(info)
    if f is not None:
        from pyodide.http import pyfetch

        r = await pyfetch(f["url"])
        files = pure_sdist_files(await r.bytes(), f["filename"]) if r.ok else None
        if files:
            site_dir = _site_packages()
            for rel, data in files.items():
                dest = os.path.normpath(os.path.join(site_dir, rel))
                if not dest.startswith(site_dir + os.sep):
                    return "compiled"
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as out:
                    out.write(data)
            importlib.invalidate_caches()
            return ""
    return "compiled"


def cannot_install_message(dists):
    """The setup error for packages that can't be installed in the browser."""
    names = ", ".join(dists)
    return (
        f"{names} can't run in the browser (compiled code with no browser build). "
        "Use Run on server, which installs any package from PyPI."
    )
