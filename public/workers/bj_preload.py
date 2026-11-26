"""Imports a cell's libraries before its time limit starts (web Pyodide worker only).

In Pyodide the first import of a big library is slow: numpy, matplotlib.pyplot and
scikit-learn compile their WebAssembly extension modules and run their package
__init__ on import, about 8 s for `import sklearn...` + `matplotlib.pyplot` on a
desktop core and several times that on a phone. That is setup, not the user's code,
so python.js calls preload() after the packages are downloaded and before the run's
clock starts; the run then finds them in sys.modules.

Only third-party modules are imported (the standard library is fast, and some of it
prints or opens things on import: `this`, `antigravity`). A module that fails to
import is skipped: the user's own import raises the real error, with its line.
"""

import ast
import importlib
import importlib.util
import os
import sys

_NOT_MODULES = set()  # names preload() found aren't modules (`from pkg import function`)
_MISSING = []  # modules a library's own import needed and didn't find, in the last preload()


def modules(code):
    """The absolute, non-standard-library modules the code imports, in order, with the
    submodules named by `from pkg import sub`. Empty for code that doesn't parse."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return []
    found = []

    def add(name):
        if name and name.split(".")[0] not in sys.stdlib_module_names and name not in found:
            found.append(name)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                add(a.name)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            add(node.module)
            for a in node.names:
                if a.name != "*":
                    add(f"{node.module}.{a.name}")  # kept only if it turns out to be a submodule
    return found


def _is_module(name):
    """find_spec imports the parents; a missing one, or a parent that isn't a package, is not a module."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def pending(code):
    """modules() not imported yet (empty on a warm run: nothing to wait for)."""
    return [m for m in modules(code) if m not in sys.modules and m not in _NOT_MODULES]


def preload(code):
    """Imports the modules modules() finds; returns the ones now imported."""
    os.environ["MPLBACKEND"] = "Agg"  # as bj_capture._prepare_matplotlib: no browser backend
    del _MISSING[:]
    before = set(sys.modules)
    done = []
    for name in modules(code):
        if name in sys.modules:
            done.append(name)
            continue
        if not _is_module(name):
            if name.rpartition(".")[0] in sys.modules:
                _NOT_MODULES.add(name)  # a name inside an imported module; a missing package may be installed later
            continue
        try:
            importlib.import_module(name)
            done.append(name)
        except ModuleNotFoundError as e:
            # A library that imports a module Pyodide ships separately (sqlite3, ssl, lzma): python.js
            # loads missing() and calls preload() again; anything else, the user's own import shows.
            top = (e.name or "").split(".")[0]
            if top and top != name.split(".")[0] and top not in _MISSING:
                _MISSING.append(top)
            _forget(name.split(".")[0], before)  # half-imported submodules would break the retry
        except Exception:
            _forget(name.split(".")[0], before)  # so the user's own import starts clean and shows the error
    return done


def _forget(package, keep=()):
    """Drops a package and its submodules from sys.modules after its import failed part way, except
    modules in `keep` (imported before: compiled ones such as NumPy's can't be imported twice)."""
    for m in [m for m in sys.modules if (m == package or m.startswith(package + ".")) and m not in keep]:
        del sys.modules[m]


def missing():
    """Modules the last preload() found missing inside a library's import (not the code's own)."""
    return list(_MISSING)


def shim_distutils():
    """`import distutils` for libraries that still use it (removed in Python 3.13): setuptools' copy."""
    if "distutils" not in sys.modules:
        import setuptools._distutils as distutils

        sys.modules["distutils"] = distutils


def shim_multiprocessing():
    """`_multiprocessing` for libraries that import multiprocessing's locks at import time (gymnasium's
    vector envs). The browser has no processes: making a lock raises, saying so; importing works."""
    if "_multiprocessing" in sys.modules:
        return
    import types

    class SemLock:
        SEM_VALUE_MAX = 2**31 - 1

        def __init__(self, *args, **kwargs):
            raise OSError("The browser has no processes or semaphores (multiprocessing). Run on server to use them.")

    m = types.ModuleType("_multiprocessing")
    m.SemLock = SemLock
    m.sem_unlink = lambda name: None
    m.flags = {}
    sys.modules["_multiprocessing"] = m
