"""bj_job.py: a background run's sandbox runs the code and sends its result back.
  python -m unittest tests/bj_job_test.py   (standard library only)"""
import http.server
import json
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "lib", "server"))
import bj_job  # noqa: E402


class App(http.server.BaseHTTPRequestHandler):
    """The app's /complete: answers each POST with the next status in `statuses`."""

    statuses = []
    bodies = []

    def do_POST(self):
        App.bodies.append(json.loads(self.rfile.read(int(self.headers["content-length"]))))
        self.send_response(App.statuses.pop(0) if App.statuses else 204)
        self.end_headers()

    def log_message(self, *args):
        pass


class JobTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), App)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/api/runs/x/complete"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        App.statuses, App.bodies = [], []

    def test_runs_the_command_and_reports_exit_code_output_and_time(self):
        with tempfile.TemporaryDirectory() as d:
            r = bj_job.run({"command": [sys.executable, "-c", "import sys; print('hi'); print('oops', file=sys.stderr); sys.exit(3)"], "token": "t"}, d)
        self.assertEqual((r["token"], r["exitCode"], r["stdout"], r["stderr"]), ("t", 3, "hi\n", "oops\n"))
        self.assertGreaterEqual(r["ms"], 0)

    def test_keeps_the_end_of_long_output_where_the_outputs_bundle_is(self):
        with tempfile.TemporaryDirectory() as d:
            code = "print('x' * 5000); print('BUNDLE')"
            old = bj_job.MAX_STDOUT
            bj_job.MAX_STDOUT = 100
            try:
                r = bj_job.run({"command": [sys.executable, "-c", code], "token": "t"}, d)
            finally:
                bj_job.MAX_STDOUT = old
        self.assertTrue(r["stdout"].startswith("[output truncated]\n"))
        self.assertTrue(r["stdout"].endswith("BUNDLE\n"))

    def test_reports_live_status_while_the_code_runs_then_saving(self):
        import threading
        import time

        seen = []
        with tempfile.TemporaryDirectory() as d:
            status = os.path.join(d, ".status.json")

            def watch():
                for _ in range(200):
                    try:
                        with open(status, encoding="utf-8") as f:
                            seen.append(json.load(f))
                    except (OSError, ValueError):
                        pass
                    time.sleep(0.02)

            t = threading.Thread(target=watch)
            t.start()
            code = "import time,sys; print('epoch 1: loss 0.5', flush=True); time.sleep(0.6); sys.stderr.write('10%\\r50%\\r90% done'); sys.stderr.flush(); time.sleep(0.6)"
            bj_job.run({"command": [sys.executable, "-c", code], "token": "t"}, d, status_every=0.1)
            t.join()
            with open(status, encoding="utf-8") as f:
                last = json.load(f)
        lines = [s["line"] for s in seen if s["phase"] == "running"]
        self.assertIn("epoch 1: loss 0.5", lines)
        self.assertIn("90% done", lines)  # only a progress bar's latest redraw
        self.assertEqual(last["phase"], "saving")
        self.assertGreater(last["elapsedSec"], 1.0)

    def test_last_line_skips_the_outputs_bundle_and_control_characters(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "out")
            with open(p, "wb") as f:
                f.write(b"real line\x1b[0m\n\n\x00BJ-OUTPUTS\x00{\"manifest\": 1}\n")
            self.assertEqual(bj_job.last_line(p, os.path.join(d, "missing")), "real line[0m")

    def test_sends_once_the_app_takes_it(self):
        self.assertTrue(bj_job.send(self.url, {"token": "t", "exitCode": 0}, sleep=lambda s: None))
        self.assertEqual(App.bodies, [{"token": "t", "exitCode": 0}])

    def test_retries_server_errors_not_refusals(self):
        App.statuses = [503, 502]
        self.assertTrue(bj_job.send(self.url, {"token": "t"}, sleep=lambda s: None))
        self.assertEqual(len(App.bodies), 3)
        App.statuses, App.bodies = [403], []
        self.assertFalse(bj_job.send(self.url, {"token": "t"}, sleep=lambda s: None))
        self.assertEqual(len(App.bodies), 1)

    def test_gives_up_after_its_attempts_when_the_app_is_unreachable(self):
        waits = []
        self.assertFalse(bj_job.send("http://127.0.0.1:9/nothing", {"token": "t"}, attempts=3, sleep=waits.append))
        self.assertEqual(waits, [1, 2, 4])


if __name__ == "__main__":
    unittest.main()
