"""bj_packages.py: which imports the browser can't provide (server-only, or try PyPI).
  python -m unittest tests/bj_packages_test.py   (no third-party packages needed)"""
import os
import sys
import unittest
from unittest import mock

WORKERS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "workers")
sys.path.insert(0, WORKERS)
import bj_packages  # noqa: E402


def plan(code, available=()):
    """plan() as if exactly `available` (plus the standard library) were installed."""
    with mock.patch.object(bj_packages, "_available", lambda name: name in available):
        p = bj_packages.plan(code)
    p.pop("blocked_downloads")  # its own tests below
    return p


class PlanTest(unittest.TestCase):
    def test_deep_learning_is_server_only(self):
        code = "import numpy as np\nimport tensorflow as tf\nfrom tensorflow import keras\nimport torch.nn as nn\n"
        self.assertEqual(plan(code, {"numpy"}), {"server_only": ["TensorFlow", "PyTorch"], "pypi": [], "optional": []})
        self.assertEqual(plan("from keras.layers import Dense")["server_only"], ["Keras"])
        self.assertEqual(plan("import jax.numpy as jnp")["server_only"], ["JAX"])

    def test_pure_python_packages_come_from_pypi_under_their_distribution_name(self):
        code = "import simpy\nimport mesa\nimport yaml\nfrom bs4 import BeautifulSoup\nimport simpy.resources\n"
        self.assertEqual(plan(code)["pypi"], ["simpy", "mesa", "pyyaml", "beautifulsoup4"])

    def test_available_and_standard_library_need_nothing(self):
        code = "import os, json, math\nimport numpy\nfrom collections import deque\nimport sklearn"
        self.assertEqual(plan(code, {"numpy", "sklearn"}), {"server_only": [], "pypi": [], "optional": []})

    def test_guarded_imports_never_stop_the_run(self):
        code = "try:\n    import torch\n    import ujson as json\nexcept ImportError:\n    import json\n"
        self.assertEqual(plan(code), {"server_only": [], "pypi": [], "optional": ["ujson"]})

    def test_an_unguarded_import_anywhere_wins(self):
        code = "try:\n    import torch\nexcept ImportError:\n    pass\nimport torch\n"
        self.assertEqual(plan(code)["server_only"], ["PyTorch"])

    def test_relative_imports_and_unparseable_code_are_ignored(self):
        self.assertEqual(plan("from . import x\nfrom .y import z"), {"server_only": [], "pypi": [], "optional": []})
        self.assertEqual(plan("import tensorflow as\n"), {"server_only": [], "pypi": [], "optional": []})

    def test_a_real_installed_module_is_found(self):
        self.assertEqual(bj_packages.plan("import unittest.mock\nimport bj_packages"), {"server_only": [], "pypi": [], "optional": [], "blocked_downloads": []})


class BlockedDownloadsTest(unittest.TestCase):
    def test_loaders_whose_sites_refuse_browsers(self):
        code = (
            "from sklearn.datasets import fetch_openml, load_iris\n"
            "import sklearn.datasets as ds\n"
            "X = ds.fetch_california_housing().data\n"
            "fetch_openml('mnist_784')\n"
        )
        self.assertEqual(bj_packages.blocked_downloads(code), ["fetch_openml", "fetch_california_housing"])
        self.assertEqual(bj_packages.plan(code)["blocked_downloads"], ["fetch_openml", "fetch_california_housing"])

    def test_loaders_that_work_in_the_browser_are_not_blocked(self):
        code = "import seaborn as sns\nsns.load_dataset('iris')\nfrom sklearn.datasets import load_digits\nimport pandas as pd\npd.read_csv('https://x/y.csv')"
        self.assertEqual(bj_packages.blocked_downloads(code), [])
        self.assertEqual(bj_packages.blocked_downloads("fetch_openml("), [])  # doesn't parse: nothing

    def test_message_points_to_the_server(self):
        m = bj_packages.blocked_downloads_message(["fetch_openml"])
        self.assertTrue(m.startswith("fetch_openml downloads from a site that doesn't allow downloads from a browser"))
        self.assertIn("Run on server", m)


class MessageTest(unittest.TestCase):
    def test_names_the_libraries_and_points_to_the_server(self):
        one = bj_packages.server_only_message(["TensorFlow"])
        self.assertTrue(one.startswith("TensorFlow doesn't run in the browser"))
        self.assertIn("Run on server", one)
        self.assertTrue(bj_packages.server_only_message(["TensorFlow", "Keras", "PyTorch"]).startswith("TensorFlow, Keras and PyTorch don't run"))



def tar_gz(files):
    import io
    import tarfile

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class InstallAssistantsTest(unittest.TestCase):
    def test_a_dependencys_version_is_a_conflict_the_package_itself_is_not(self):
        msg = "ValueError: Can't find a pure Python 3 wheel for 'scikit-learn>=1.8.0'.\nSee: ..."
        self.assertEqual(bj_packages.dependency_conflict(msg, "mlxtend"), "scikit-learn>=1.8.0")
        self.assertIsNone(bj_packages.dependency_conflict("Can't find a pure Python 3 wheel for 'shap'.", "shap"))
        self.assertIsNone(bj_packages.dependency_conflict("Can't find a pure Python 3 wheel for 'Scikit_Learn'.", "scikit-learn"))
        self.assertIsNone(bj_packages.dependency_conflict("network error", "x"))
        loaded = "ValueError: Requested 'scikit-learn>=1.8.0', but scikit-learn==1.7.0 is already installed"
        self.assertEqual(bj_packages.dependency_conflict(loaded, "mlxtend"), "scikit-learn>=1.8.0")

    def test_older_versions_are_final_pure_releases_newest_first(self):
        wheel = lambda v, tag="py3-none-any", **k: dict(filename=f"pkg-{v}-{tag}.whl", **k)  # noqa: E731
        info = {
            "info": {"version": "0.24.0"},
            "releases": {
                "0.24.0": [wheel("0.24.0")],
                "0.23.4": [wheel("0.23.4")],
                "0.23.3": [wheel("0.23.3", yanked=True)],
                "0.23.2": [wheel("0.23.2", "cp312-cp312-manylinux_2_17_x86_64")],
                "0.23.1": [wheel("0.23.1", "py2.py3-none-any")],
                "0.25.0rc1": [wheel("0.25.0rc1")],
                "0.9.0": [wheel("0.9.0")],
                "not-a-version": [wheel("x")],
            },
        }
        self.assertEqual(bj_packages.older_versions(info), ["0.23.4", "0.23.1", "0.9.0"])
        self.assertEqual(bj_packages.older_versions(info, limit=1), ["0.23.4"])

    def test_sdist_only_when_the_newest_release_has_no_wheel(self):
        sdist = {"filename": "lime-0.2.0.1.tar.gz", "packagetype": "sdist", "url": "u"}
        self.assertEqual(bj_packages.sdist_file({"urls": [sdist]}), sdist)
        self.assertIsNone(bj_packages.sdist_file({"urls": [sdist, {"filename": "x-1-cp312-cp312-linux.whl", "packagetype": "bdist_wheel"}]}))

    def test_a_pure_source_installs_its_packages_and_modules_only(self):
        data = tar_gz({
            "lime-0.2/setup.py": b"setup()",
            "lime-0.2/lime/__init__.py": b"",
            "lime-0.2/lime/lime_tabular.py": b"x = 1",
            "lime-0.2/lime/data/words.txt": b"w",
            "lime-0.2/tests/__init__.py": b"",
            "lime-0.2/assistant.py": b"y = 2",
            "lime-0.2/README.md": b"r",
        })
        self.assertEqual(sorted(bj_packages.pure_sdist_files(data, "lime-0.2.tar.gz")), ["assistant.py", "lime/__init__.py", "lime/data/words.txt", "lime/lime_tabular.py"])

    def test_src_layout(self):
        data = tar_gz({"p-1/src/p/__init__.py": b"", "p-1/src/p/a.py": b"", "p-1/pyproject.toml": b""})
        self.assertEqual(sorted(bj_packages.pure_sdist_files(data, "p-1.tar.gz")), ["p/__init__.py", "p/a.py"])

    def test_compiled_or_unsafe_sources_are_refused(self):
        self.assertIsNone(bj_packages.pure_sdist_files(tar_gz({"h-1/h/__init__.py": b"", "h-1/h/_fast.pyx": b""}), "h-1.tar.gz"))
        self.assertIsNone(bj_packages.pure_sdist_files(tar_gz({"h-1/h/__init__.py": b"", "h-1/h/core.c": b""}), "h-1.tar.gz"))
        self.assertIsNone(bj_packages.pure_sdist_files(tar_gz({"a/x/__init__.py": b"", "b/y.py": b""}), "two-roots.tar.gz"))
        self.assertIsNone(bj_packages.pure_sdist_files(tar_gz({"h-1/h/__init__.py": b"", "h-1/h/../../../etc/x.py": b""}), "h-1.tar.gz"))

    def test_messages(self):
        self.assertIn("Run on server", bj_packages.cannot_install_message(["shap"]))
        self.assertEqual(bj_packages.PYPI_NAMES["sklearn"], "scikit-learn")


if __name__ == "__main__":
    unittest.main()
