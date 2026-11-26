"""bj_preload.py: what the web worker imports before a run's time limit starts.
  python -m unittest tests/bj_preload_test.py   (CI's outputs job, with matplotlib and scikit-learn)"""
import contextlib
import io
import os
import subprocess
import sys
import unittest

WORKERS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "workers")
sys.path.insert(0, WORKERS)
import bj_preload  # noqa: E402

# The user's case (2026-11-07): stopped at the 30 s limit on a phone, mostly first imports.
DIGITS = """import numpy as np
import matplotlib.pyplot as plt
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
X, y = load_digits(return_X_y=True)
"""


def fresh(code):
    """preload() in a new interpreter: its result, pending() after, MPLBACKEND and pyplot's backend, as printed."""
    script = (
        f"import sys, os; sys.path.insert(0, {WORKERS!r}); import bj_preload\n"
        f"CODE = {code!r}\n"
        "done = bj_preload.preload(CODE)\n"
        "print(done)\n"
        "print(bj_preload.pending(CODE))\n"
        "print(os.environ.get('MPLBACKEND'))\n"
        "print(sys.modules['matplotlib'].get_backend().lower() if 'matplotlib.pyplot' in sys.modules else None)\n"
    )
    return subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True).stdout.splitlines()


class Modules(unittest.TestCase):
    def test_third_party_imports_with_from_submodules_in_order(self):
        self.assertEqual(
            bj_preload.modules(DIGITS),
            [
                "numpy",
                "matplotlib.pyplot",
                "sklearn.datasets",
                "sklearn.datasets.load_digits",
                "sklearn.model_selection",
                "sklearn.model_selection.train_test_split",
                "sklearn.ensemble",
                "sklearn.ensemble.RandomForestClassifier",
            ],
        )

    def test_skips_stdlib_relative_star_and_bad_code(self):
        self.assertEqual(bj_preload.modules("import this, os.path\nfrom json import loads\nfrom . import x\nfrom pandas import *"), ["pandas"])
        self.assertEqual(bj_preload.modules("def f(:\n  import numpy"), [])

    def test_imports_inside_functions_count(self):
        self.assertEqual(bj_preload.modules("def f():\n    import scipy.stats\n"), ["scipy.stats"])


class Preload(unittest.TestCase):
    def test_missing_module_is_skipped_quietly(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            self.assertEqual(bj_preload.preload("import no_such_pkg_bj\nfrom no_such_pkg_bj.sub import x"), [])
        self.assertEqual(out.getvalue(), "")
        # Not remembered: it may be installed before the next run.
        self.assertEqual(bj_preload.pending("import no_such_pkg_bj"), ["no_such_pkg_bj"])

    def test_stdlib_side_effects_are_left_to_the_users_code(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            bj_preload.preload("import this")
        self.assertEqual(out.getvalue(), "")

    def test_digits_cell_is_imported_before_the_run_and_nothing_is_pending_after(self):
        done, pending, env, backend = fresh(DIGITS)
        self.assertEqual(
            eval(done),
            ["numpy", "matplotlib.pyplot", "sklearn.datasets", "sklearn.model_selection", "sklearn.ensemble"],
        )
        self.assertEqual(pending, "[]")  # the warm run shows no "Loading Python packages…"
        self.assertEqual(env, "Agg")
        self.assertEqual(backend, "agg")



class MissingInsideLibrary(unittest.TestCase):
    def test_reports_a_module_a_library_needs_not_the_codes_own_missing_import(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "bj_fake_lib.py"), "w") as f:
                f.write("import bj_unvendored_module\n")
            sys.path.insert(0, d)
            try:
                bj_preload.preload("import bj_fake_lib\nimport bj_not_installed_at_all\n")
                self.assertEqual(bj_preload.missing(), ["bj_unvendored_module"])
                bj_preload.preload("import json")
                self.assertEqual(bj_preload.missing(), [])
            finally:
                sys.path.remove(d)
                sys.modules.pop("bj_fake_lib", None)


class Shims(unittest.TestCase):
    def test_multiprocessing_imports_and_explains_when_used(self):
        script = (
            f"import sys; sys.path.insert(0, {WORKERS!r}); sys.modules['_multiprocessing'] = None\n"
            "del sys.modules['_multiprocessing']\n"
            "import bj_preload; bj_preload.shim_multiprocessing()\n"
            "from multiprocessing import synchronize\n"
            "try:\n    synchronize.Lock(ctx=None)\nexcept OSError as e:\n    print('raised:', e)\n"
        )
        out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True).stdout
        self.assertIn("raised: The browser has no processes", out)

    def test_distutils_comes_from_setuptools(self):
        script = (
            f"import sys; sys.path.insert(0, {WORKERS!r}); import bj_preload; bj_preload.shim_distutils()\n"
            "from distutils.version import LooseVersion; print(LooseVersion('1.2') < LooseVersion('1.10'))"
        )
        r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True)
        if "No module named 'setuptools'" in r.stderr:
            self.skipTest("setuptools isn't installed here")
        self.assertEqual(r.stdout.strip(), "True", r.stderr)


if __name__ == "__main__":
    unittest.main()
