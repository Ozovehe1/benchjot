"""A background server run (Python, on Modal): runs the code and sends its result back.

The sandbox's own command starts this once the run's files are written (src/lib/server/modal.ts,
startOnModal). It reads .job.json next to it: `command` (the code under its time limit, as for a
run that waits in the request), `callback` (the app's /api/runs/<id>/complete) and `token` (that
run's one-time secret). It runs the command with stdout and stderr to files, then POSTs
{token, exitCode, stdout, stderr, ms} to the callback, retrying a few times: the app stores the
result for the user, whether or not their page is open.

While the code runs, a small .status.json next to it says what is happening (the phase, how long
the code has run, its latest line of output); the app reads it to show the user live progress.

Standard library only: it runs before, and apart from, the user's code.
"""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# stdout ends with bj_capture's outputs bundle (up to SERVER_OUTPUT_BYTES as base64), so its tail is
# kept; stderr's tail has the error. The request must stay under the host's 4.5 MB body limit.
MAX_STDOUT = 3_900_000
MAX_STDERR = 250_000
ATTEMPTS = 6


def tail(path, limit):
    """The file's last `limit` bytes as text ("" when it doesn't exist)."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - limit))
            data = f.read()
    except OSError:
        return ""
    text = data.decode("utf-8", "replace")
    return ("[output truncated]\n" + text) if size > limit else text


def last_line(*paths, limit=160):
    """The latest non-empty line written to any of the files (the newest file wins), as a terminal
    would show it: after a carriage return only the redraw counts. "" when there is none."""
    best = (0.0, "")
    for path in paths:
        try:
            mtime = os.path.getmtime(path)
            with open(path, "rb") as f:
                f.seek(0, os.SEEK_END)
                f.seek(max(0, f.tell() - 4000))
                text = f.read().decode("utf-8", "replace")
        except OSError:
            continue
        if "\x00BJ-OUTPUTS\x00" in text:  # the outputs bundle at the end of stdout isn't a line to show
            text = text.split("\x00BJ-OUTPUTS\x00", 1)[0]
        lines = [seg.split("\r")[-1].strip() for seg in text.replace("\r\n", "\n").split("\n")]
        lines = ["".join(c for c in ln if c.isprintable()) for ln in lines]
        lines = [ln for ln in lines if ln]
        if lines and mtime >= best[0]:
            best = (mtime, lines[-1][:limit])
    return best[1]


def write_status(workdir, phase, elapsed=0.0, line=""):
    """Writes .status.json whole (written aside, then renamed, so a reader never sees half of it)."""
    path = os.path.join(workdir, ".status.json")
    try:
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"phase": phase, "elapsedSec": round(elapsed, 1), "line": line}, f)
        os.replace(path + ".tmp", path)
    except OSError:
        pass  # progress is a courtesy: never fail the run over it


def run(job, workdir=HERE, status_every=2.0):
    """Runs the job's command in `workdir`; returns the result to send back."""
    out_path, err_path = os.path.join(workdir, ".stdout"), os.path.join(workdir, ".stderr")
    started = time.monotonic()
    done = threading.Event()

    def report():
        while not done.is_set():
            write_status(workdir, "running", time.monotonic() - started, last_line(out_path, err_path))
            done.wait(status_every)

    write_status(workdir, "running")
    reporter = threading.Thread(target=report, daemon=True)
    reporter.start()
    try:
        with open(out_path, "wb") as out, open(err_path, "wb") as err:
            code = subprocess.call(job["command"], cwd=workdir, stdout=out, stderr=err)
    finally:
        done.set()
        reporter.join(timeout=5)
    ms = int((time.monotonic() - started) * 1000)
    write_status(workdir, "saving", ms / 1000)
    return {
        "token": job["token"],
        "exitCode": code,
        "stdout": tail(out_path, MAX_STDOUT),
        "stderr": tail(err_path, MAX_STDERR),
        "ms": ms,
    }


def send(callback, result, attempts=ATTEMPTS, sleep=time.sleep):
    """POSTs the result; True once the app took it (2xx). Retries network failures and 5xx."""
    body = json.dumps(result).encode("utf-8")
    for i in range(attempts):
        try:
            req = urllib.request.Request(callback, data=body, method="POST", headers={"content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                if 200 <= r.status < 300:
                    return True
        except urllib.error.HTTPError as e:
            if e.code < 500:
                print(f"bj_job: the app refused the result ({e.code})", file=sys.stderr)
                return False
        except Exception as e:  # noqa: BLE001 (network errors of any kind: retry)
            print(f"bj_job: sending the result failed ({e}), retrying", file=sys.stderr)
        sleep(min(30, 2**i))
    return False


def main():
    with open(os.path.join(HERE, ".job.json"), encoding="utf-8") as f:
        job = json.load(f)
    result = run(job)
    sys.exit(0 if send(job["callback"], result) else 1)


if __name__ == "__main__":
    main()
