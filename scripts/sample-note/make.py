#!/usr/bin/env python3
"""The landing page's example note: runs experiment.py through bj_capture.py (as the
app does) and writes what it captured, so every number and picture on the landing is real.

  python3 scripts/sample-note/make.py          writes src/lib/sample-run.json + public/sample-outputs/
  python3 scripts/sample-note/make.py --check  CI: the run still prints and captures the same
                                               (text, manifest, table CSV, chart spec; not image bytes)
Libraries: scripts/output-fixtures.txt. The Android app copies both (its scripts/web-fixtures.mjs).
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "public", "workers"))
import bj_capture  # noqa: E402

CODE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "experiment.py")
RUN = os.path.join(ROOT, "src", "lib", "sample-run.json")
ASSETS = os.path.join(ROOT, "public", "sample-outputs")
# Shaped like a stored run's folder ({user}/{snippet}/{run}); the landing reads ASSETS instead.
DIR = "00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002"
COMPARED = (".csv", ".json")


def code_hash(code):
    """src/lib/run/last-run.ts codeHash (cyrb53 over UTF-16 code units); tests check they agree."""
    def imul(a, b):
        r = (a * b) & 0xFFFFFFFF
        return r - (1 << 32) if r & 0x80000000 else r
    u = lambda x: x & 0xFFFFFFFF
    h1, h2 = 0xDEADBEEF, 0x41C6CE57
    units = code.encode("utf-16-le")
    for i in range(0, len(units), 2):
        c = units[i] | units[i + 1] << 8
        h1 = imul(u(h1) ^ c, 2654435761)
        h2 = imul(u(h2) ^ c, 1597334677)
    h1 = imul(u(h1) ^ (u(h1) >> 16), 2246822507) ^ imul(u(h2) ^ (u(h2) >> 13), 3266489909)
    h2 = imul(u(h2) ^ (u(h2) >> 16), 2246822507) ^ imul(u(h1) ^ (u(h1) >> 13), 3266489909)
    return format(4294967296 * (2097151 & u(h2)) + u(h1), "x")


def capture(out):
    code = open(CODE, encoding="utf-8").read()
    stdout = io.StringIO()
    t = time.perf_counter()
    with contextlib.redirect_stdout(stdout):
        manifest = bj_capture.run_sync(code, out, filename="experiment.py")
    return code, stdout.getvalue(), manifest, round((time.perf_counter() - t) * 1000)


def main(check):
    with tempfile.TemporaryDirectory() as out:
        code, stdout, manifest, ms = capture(out)
        if check:
            saved = json.load(open(RUN, encoding="utf-8"))
            run = saved["last_run"]
            errors = []
            if saved["code"] != code:
                errors.append("experiment.py changed")
            if run["stdout"] != stdout:
                errors.append(f"stdout differs:\n{stdout}")
            if {k: v for k, v in run["outputs"].items() if k != "dir"} != manifest:
                errors.append("manifest differs")
            for name in sorted(os.listdir(out)):
                if name.endswith(COMPARED) and name != "manifest.json":
                    if open(os.path.join(out, name), "rb").read() != open(os.path.join(ASSETS, name), "rb").read():
                        errors.append(f"{name} differs")
            if errors:
                sys.exit("Sample note is stale (run scripts/sample-note/make.py and commit):\n" + "\n".join(errors))
            print("sample note is current")
            return
        shutil.rmtree(ASSETS, ignore_errors=True)
        os.makedirs(ASSETS)
        for name in os.listdir(out):
            if name != "manifest.json":
                shutil.copy(os.path.join(out, name), ASSETS)
    run = {
        "outcome": "ok", "stdout": stdout, "stderr": "", "error_line": None, "line": None, "ms": ms,
        "where": "server", "code_hash": code_hash(code), "ran_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "outputs": {**manifest, "dir": DIR},
    }
    with open(RUN, "w", encoding="utf-8") as f:
        json.dump({"code": code, "last_run": run}, f, indent=2)
        f.write("\n")
    print(f"wrote {RUN} and {ASSETS}")


if __name__ == "__main__":
    main("--check" in sys.argv)
