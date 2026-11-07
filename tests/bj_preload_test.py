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


if __name__ == "__main__":
    unittest.main()
