"""bj_capture.py checks that need the real plotting libraries (CI's outputs job):
  python -m unittest tests/bj_capture_test.py"""
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "workers"))
import bj_capture  # noqa: E402
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402


def surface():
    # The user's case: z label cut to "log10 l" at the right edge (matplotlib < 3.9).
    fig = plt.figure(figsize=(8, 6))
    ax = fig.add_subplot(projection="3d")
    x, y = np.meshgrid(np.linspace(-3, 3, 20), np.linspace(-3, 3, 20))
    ax.plot_surface(x, y, np.log10(1 + x**2 + y**2))
    ax.set_xlabel("learning rate")
    ax.set_ylabel("weight decay")
    ax.set_zlabel("log10 loss")
    ax.view_init(35, -60)
    return fig, ax


class ThreeDLabels(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_every_3d_axis_label_counts_in_the_tight_crop(self):
        fig, ax = surface()
        extra = bj_capture._bbox_extra(fig)
        for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
            self.assertIn(axis.label, extra["bbox_extra_artists"])
        fig.savefig(io.BytesIO(), format="png", dpi=100, bbox_inches="tight", **extra)
        r = fig.canvas.get_renderer()
        crop = fig.get_tightbbox(r, bbox_extra_artists=extra["bbox_extra_artists"])
        for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
            label = axis.label.get_window_extent(r)
            self.assertLessEqual(label.x1, crop.x1 * fig.dpi + 0.5, axis.label.get_text())
            self.assertGreaterEqual(label.x0, crop.x0 * fig.dpi - 0.5, axis.label.get_text())

    def test_2d_figures_save_as_before(self):
        fig = plt.figure()
        plt.plot([1, 2], [3, 4])
        self.assertEqual(bj_capture._bbox_extra(fig), {})

    def test_captured_3d_figure_keeps_its_png_and_itself(self):
        with tempfile.TemporaryDirectory() as d:
            m = bj_capture.run_sync(SURFACE_CODE, d)
            self.assertEqual([i["kind"] for i in m["items"]], ["image"])
            self.assertEqual(m["items"][0]["files"], {"png": "0.png", "mpl": "0.mpl"})
            self.assertEqual(m["items"][0]["matplotlib"], matplotlib.__version__)
            self.assertEqual(sorted(os.listdir(d)), ["0.mpl", "0.png", "manifest.json"])


def read(path):
    with open(path, "rb") as f:
        return f.read()


def png_pixels(data):
    from PIL import Image

    return np.asarray(Image.open(io.BytesIO(data)).convert("RGBA")).astype(int)


def tight_png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=bj_capture.FIG_DPI, bbox_inches="tight", **bj_capture._bbox_extra(fig))
    return buf.getvalue()


SURFACE_CODE = (
    "import matplotlib.pyplot as plt\nimport numpy as np\n"
    "x, y = np.meshgrid(np.linspace(-5, 5, 60), np.linspace(-5, 5, 60))\n"
    "fig = plt.figure(figsize=(8, 6))\nax = fig.add_subplot(projection='3d')\n"
    "ax.plot_surface(x, y, np.sin(np.sqrt(x**2 + y**2)), cmap='viridis')\nax.set_zlabel('z')\nplt.show()\n"
)


class OneDrawPng(unittest.TestCase):
    """The run's PNG comes from one draw and matches savefig(bbox_inches="tight")."""

    def tearDown(self):
        plt.close("all")

    def assertLooksSaved(self, fig):
        mine, saved = png_pixels(bj_capture._png(fig, bj_capture._bbox_extra(fig))), png_pixels(tight_png(fig))
        self.assertEqual(mine.shape, saved.shape)
        # The same picture, up to anti-aliasing: savefig draws the crop at a sub-pixel offset.
        self.assertLess(np.abs(mine - saved).mean(), 3)
        self.assertLess((np.abs(mine - saved).max(axis=2) > 32).mean(), 0.03)

    def test_3d_surface(self):
        fig, _ = surface()
        self.assertIsNotNone(bj_capture._png_one_draw(fig, bj_capture._bbox_extra(fig)))
        self.assertLooksSaved(fig)

    def test_tight_layout_fills_the_canvas_and_the_padding_is_background(self):
        fig, axs = plt.subplots(1, 2, figsize=(6, 3))
        im = axs[0].imshow(np.arange(12).reshape(3, 4))
        fig.colorbar(im, ax=axs[0])
        axs[1].hist(np.random.default_rng(0).normal(size=200), bins=10)
        fig.suptitle("S")
        fig.tight_layout()
        self.assertIsNotNone(bj_capture._png_one_draw(fig, {}))
        self.assertLooksSaved(fig)

    def test_coloured_figure_background(self):
        fig = plt.figure(facecolor="#202020")
        plt.plot([1, 2], [2, 1])
        self.assertLooksSaved(fig)

    def test_artist_outside_the_canvas_is_saved_by_savefig(self):
        fig, ax = plt.subplots()
        ax.plot([1, 2])
        ax.legend(["outside"], bbox_to_anchor=(1.4, 1))
        self.assertIsNone(bj_capture._png_one_draw(fig, {}))
        self.assertEqual(bj_capture._png(fig, {}), tight_png(fig))

    def test_figure_keeps_its_dpi(self):
        fig = plt.figure(dpi=72)
        bj_capture._png(fig, {})
        self.assertEqual(fig.dpi, 72)


class KeptFigures(unittest.TestCase):
    """SVG / PDF are made on Download from the figure kept at run time."""

    def tearDown(self):
        plt.close("all")

    def capture(self, code, **kw):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d)
        m = bj_capture.run_sync(code, d, **kw)
        return d, m["items"]

    def test_render_makes_the_same_svg_and_pdf_as_the_server(self):
        d, [kept] = self.capture(SURFACE_CODE)
        s, [server] = self.capture(SURFACE_CODE, vectors=True)
        self.assertEqual(server["files"], {"png": "0.png", "svg": "0.svg", "pdf": "0.pdf"})
        self.assertNotIn("matplotlib", server)
        data = read(os.path.join(d, kept["files"]["mpl"]))
        svg = bj_capture.render(data, "svg", kept["matplotlib"])
        pdf = bj_capture.render(data, "pdf", kept["matplotlib"])
        self.assertTrue(svg.startswith(b"<?xml"))
        self.assertTrue(pdf.startswith(b"%PDF"))
        size = lambda b: re.search(rb'width="([\d.]+)pt" height="([\d.]+)pt"', b).groups()
        self.assertEqual(size(svg), size(read(os.path.join(s, "0.svg"))))
        mediabox = lambda b: re.search(rb"/MediaBox \[([^\]]+)\]", b).group(1)
        self.assertEqual(mediabox(pdf), mediabox(read(os.path.join(s, "0.pdf"))))

    def test_render_file_and_no_pyplot_figure_left_behind(self):
        d, [kept] = self.capture(SURFACE_CODE)
        before = plt.get_fignums()
        dest = os.path.join(d, "out.pdf")
        bj_capture.render_file(os.path.join(d, kept["files"]["mpl"]), "pdf", dest, kept["matplotlib"])
        self.assertTrue(read(dest).startswith(b"%PDF"))
        self.assertEqual(plt.get_fignums(), before)

    def test_render_refuses_another_matplotlib(self):
        d, [kept] = self.capture(SURFACE_CODE)
        data = read(os.path.join(d, kept["files"]["mpl"]))
        with self.assertRaises(bj_capture.RenderError) as e:
            bj_capture.render(data, "svg", "2.0.0")
        self.assertIn("matplotlib 2.0", str(e.exception))
        with self.assertRaises(bj_capture.RenderError):
            bj_capture.render(data, "png", kept["matplotlib"])
        with self.assertRaises(bj_capture.RenderError):
            bj_capture.render(b"not a figure", "svg", kept["matplotlib"])

    def test_render_lets_a_missing_library_through_for_the_runner_to_load(self):
        import gzip

        refers = gzip.compress(b"cnot_a_library_bj\nThing\n.")  # a pickle naming a module this Python lacks
        with self.assertRaises(ModuleNotFoundError) as e:
            bj_capture.render(refers, "svg", matplotlib.__version__)
        self.assertEqual(e.exception.name, "not_a_library_bj")

    def test_figure_that_cant_be_kept_saves_svg_and_pdf_now(self):
        lam = "import matplotlib.pyplot as plt\nfrom matplotlib.ticker import FuncFormatter\nfig, ax = plt.subplots()\nax.plot([1, 2])\nax.yaxis.set_major_formatter(FuncFormatter(lambda v, p: f'{v:.1f}'))\nplt.show()\n"
        own = "import matplotlib.pyplot as plt\nfrom matplotlib.ticker import Formatter\nclass F(Formatter):\n    def __call__(self, v, p=None):\n        return str(v)\nfig, ax = plt.subplots()\nax.plot([1, 2])\nax.yaxis.set_major_formatter(F())\nplt.show()\n"
        for code in (lam, own):
            _, [item] = self.capture(code)
            self.assertEqual(item["files"], {"png": "0.png", "svg": "0.svg", "pdf": "0.pdf"})
            self.assertNotIn("matplotlib", item)



# A simulation: a damped oscillator stepped with explicit Euler, drawn frame by frame.
OSCILLATOR = """
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

dt, k, c = 0.05, 4.0, 0.3
x, v = 1.0, 0.0
xs = []
for _ in range(400):
    v += (-k * x - c * v) * dt
    x += v * dt
    xs.append(x)

fig, ax = plt.subplots(figsize=(4, 3))
ax.set_xlim(0, len(xs)); ax.set_ylim(-1.1, 1.1); ax.set_title("Damped oscillator")
(line,) = ax.plot([], [])

def step(i):
    line.set_data(range(i + 2), xs[: i + 2])  # every frame differs (GIF merges equal ones)
    return (line,)

anim = FuncAnimation(fig, step, frames=len(xs), interval=20, blit=True)
"""


def gif_frames(path):
    from PIL import Image

    with Image.open(path) as im:
        return im.n_frames, im.size


class Animations(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def check_one_gif(self, code, title="Damped oscillator"):
        with tempfile.TemporaryDirectory() as d:
            m = bj_capture.run_sync(code, d)
            self.assertEqual(len(m["items"]), 1, m)  # the GIF, not also a still of its figure
            item = m["items"][0]
            self.assertEqual((item["kind"], item["source"], item["name"], item["title"]), ("image", "file", "animation-1.gif", title))
            # Where ffmpeg is installed (the server), the animation is kept as an MP4 video too.
            import shutil

            video = {"mp4": "0.mp4"} if shutil.which("ffmpeg") else {}
            self.assertEqual(item["files"], {**video, "gif": "0.gif", "strip": "0.png"})
            if video:
                with open(os.path.join(d, "0.mp4"), "rb") as f:
                    self.assertEqual(f.read(12)[4:8], b"ftyp")
            n, size = gif_frames(os.path.join(d, "0.gif"))
            self.assertEqual(n, 100)  # 400 frames asked, limit 120: every 4th, so all of the simulation plays
            self.assertEqual(size, (item["width"], item["height"]))
            return m

    def test_an_animation_left_in_a_variable_becomes_a_capped_gif(self):
        self.check_one_gif(OSCILLATOR)

    def test_plt_show_and_the_last_expression_capture_it_once(self):
        self.check_one_gif(OSCILLATOR + "plt.show()\n")
        self.check_one_gif(OSCILLATOR + "anim\n")

    def test_an_animation_the_code_saves_itself_is_its_own_file_only(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as cwd:
            old = os.getcwd()
            os.chdir(cwd)
            try:
                m = bj_capture.run_sync(OSCILLATOR.replace("frames=len(xs)", "frames=10") + "anim.save('sim.gif', writer='pillow')\n", d)
            finally:
                os.chdir(old)
            names = [i.get("name") for i in m["items"]]
            self.assertEqual(names.count("sim.gif"), 1)
            self.assertNotIn("animation-1.gif", names)

    def test_other_figures_still_show_as_stills(self):
        with tempfile.TemporaryDirectory() as d:
            m = bj_capture.run_sync("import matplotlib.pyplot as plt\nplt.figure(); plt.plot([1, 2])\n" + OSCILLATOR, d)
            self.assertEqual(sorted(i["files"].get("gif", "") != "" for i in m["items"]), [False, True])

    def test_a_gif_too_large_for_the_limits_is_made_lighter_so_both_come_back(self):
        import shutil

        if not shutil.which("ffmpeg"):
            self.skipTest("needs ffmpeg")
        old = bj_capture.MAX_TOTAL_BYTES
        bj_capture.MAX_TOTAL_BYTES = 110_000  # the MP4 (about 9 KB) fits; the full GIF (about 190 KB) doesn't
        try:
            with tempfile.TemporaryDirectory() as d:
                m = bj_capture.run_sync(OSCILLATOR, d)
                # The frame strip comes only if it still fits: never a note about it.
                files = m["items"][0]["files"]
                self.assertEqual({k: v for k, v in files.items() if k != "strip"}, {"mp4": "0.mp4", "gif": "0.gif"})
                self.assertEqual(m["notes"], [])
                self.assertLessEqual(sum(os.path.getsize(os.path.join(d, n)) for n in files.values()), 110_000)
                n, _ = gif_frames(os.path.join(d, "0.gif"))
                self.assertLess(n, 100)  # fewer frames than the full one
                self.assertGreaterEqual(n, 6)
                self.assertLessEqual(os.path.getsize(os.path.join(d, "0.gif")) + os.path.getsize(os.path.join(d, "0.mp4")), 110_000)
        finally:
            bj_capture.MAX_TOTAL_BYTES = old

    def test_a_video_the_code_writes_is_an_output(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as cwd:
            old = os.getcwd()
            os.chdir(cwd)
            try:
                m = bj_capture.run_sync("open('sim.mp4', 'wb').write(b'\\x00\\x00\\x00\\x18ftypisom' + b'\\x00' * 64)", d)
            finally:
                os.chdir(old)
            self.assertEqual([(i["name"], i["files"]) for i in m["items"]], [("sim.mp4", {"mp4": "0.mp4"})])



class ScipyCompat(unittest.TestCase):
    def test_libraries_importing_scipy_interp_still_work(self):
        import scipy

        scipy.__dict__.pop("interp", None)
        with tempfile.TemporaryDirectory() as d:
            bj_capture.run_sync("from scipy import interp\nprint(interp(1.5, [1, 2], [10, 20]))", d)
        self.assertIs(scipy.interp, np.interp)


class Collect(unittest.TestCase):
    """--collect: another language's program run as a command; the images it writes are the outputs."""

    def run_collect(self, program):
        import subprocess

        with tempfile.TemporaryDirectory() as cwd:
            r = subprocess.run(
                [sys.executable, os.path.join(os.path.dirname(bj_capture.__file__), "bj_capture.py"), "--collect", "out", "--", sys.executable, "-c", program],
                cwd=cwd, capture_output=True, text=True,
            )
            return r

    def test_returns_the_exit_code_the_output_and_the_written_images(self):
        png = "import sys,struct,zlib; print('hello'); print('warn', file=sys.stderr)\n" \
              "raw=b'\\x89PNG\\r\\n\\x1a\\n'+struct.pack('>I',13)+b'IHDR'+struct.pack('>IIBBBBB',7,5,8,2,0,0,0)+b'0000'\n" \
              "open('figure-1.png','wb').write(raw); sys.exit(3)"
        r = self.run_collect(png)
        self.assertEqual(r.returncode, 3)
        self.assertEqual(r.stderr, "warn\n")
        out, _, bundle = r.stdout.partition("\n" + bj_capture.BUNDLE_MARK)
        self.assertEqual(out, "hello\n")
        import json

        items = json.loads(bundle)["manifest"]["items"]
        self.assertEqual([(i["name"], i["width"], i["height"]) for i in items], [("figure-1.png", 7, 5)])

    def test_no_images_no_bundle(self):
        r = self.run_collect("print('just text')")
        self.assertEqual((r.returncode, r.stdout), (0, "just text\n"))


class DatasetCache(unittest.TestCase):
    """torchvision's download_url takes a kept file (the image's, or the user's own cache) instead
    of downloading it, and keeps what it does download in the user's cache for the next run."""

    CODE = (
        "from torchvision.datasets.utils import download_and_extract_archive\n"
        "download_and_extract_archive('https://www.cs.toronto.edu/~kriz/cifar-10-python.tar.gz', 'data', filename='c.tar.gz')\n"
        "download_and_extract_archive('https://example.org/sets/other.bin?token=1', 'data', filename='other.bin')\n"
    )

    def run_cell(self, tmp, work):
        """Runs CODE in a fresh folder `work`; returns the URLs really downloaded."""
        os.makedirs(work)
        old = os.getcwd()
        os.chdir(work)
        try:
            for m in [m for m in sys.modules if m.startswith("torchvision")]:
                del sys.modules[m]
            bj_capture.run_sync(self.CODE, os.path.join(work, "out"))
            return list(sys.modules["torchvision.datasets.utils"].downloaded)
        finally:
            os.chdir(old)

    def test_kept_files_are_copied_downloads_are_kept_for_next_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = os.path.join(tmp, "pkgs", "torchvision", "datasets")
            os.makedirs(pkg)
            open(os.path.join(tmp, "pkgs", "torchvision", "__init__.py"), "w").close()
            open(os.path.join(pkg, "__init__.py"), "w").close()
            with open(os.path.join(pkg, "utils.py"), "w") as f:  # a stand-in with torchvision's shape
                f.write(
                    "import os\ndownloaded = []\n"
                    "def download_url(url, root, filename=None, md5=None):\n"
                    "    downloaded.append(url)\n    os.makedirs(root, exist_ok=True)\n"
                    "    open(os.path.join(root, filename), 'wb').write(b'DOWNLOADED')\n"
                    "def download_and_extract_archive(url, download_root, filename=None, md5=None):\n    download_url(url, download_root, filename, md5)\n"
                )
            kept = os.path.join(tmp, "image", "www.cs.toronto.edu", "~kriz")
            os.makedirs(kept)
            with open(os.path.join(kept, "cifar-10-python.tar.gz"), "wb") as f:
                f.write(b"CIFAR")
            mine = os.path.join(tmp, "mine")
            old_env = {k: os.environ.get(k) for k in ("BJ_DATASETS", "BJ_DOWNLOADS")}
            os.environ.update(BJ_DATASETS=os.path.join(tmp, "image"), BJ_DOWNLOADS=mine)
            sys.path.insert(0, os.path.join(tmp, "pkgs"))
            try:
                # First run: CIFAR from the image; the other file is downloaded, and kept (by URL, no query).
                first = self.run_cell(tmp, os.path.join(tmp, "run1"))
                self.assertEqual(first, ["https://example.org/sets/other.bin?token=1"])
                with open(os.path.join(tmp, "run1", "data", "c.tar.gz"), "rb") as f:
                    self.assertEqual(f.read(), b"CIFAR")
                self.assertTrue(os.path.isfile(os.path.join(mine, "example.org", "sets", "other.bin")))
                # Next run, another folder: nothing is downloaded.
                second = self.run_cell(tmp, os.path.join(tmp, "run2"))
                self.assertEqual(second, [])
                with open(os.path.join(tmp, "run2", "data", "other.bin"), "rb") as f:
                    self.assertEqual(f.read(), b"DOWNLOADED")
            finally:
                sys.path.remove(os.path.join(tmp, "pkgs"))
                for m in [m for m in sys.modules if m.startswith("torchvision")]:
                    del sys.modules[m]
                for k, v in old_env.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v

    def test_a_url_can_not_reach_outside_the_cache(self):
        class Utils:
            calls = []

            @staticmethod
            def download_url(url, root, filename=None):
                Utils.calls.append(url)

        with tempfile.TemporaryDirectory() as tmp:
            old = os.environ.get("BJ_DOWNLOADS")
            os.environ["BJ_DOWNLOADS"] = os.path.join(tmp, "mine")
            secret = os.path.join(tmp, "secret.txt")
            open(secret, "w").write("x")
            try:
                bj_capture._dataset_cache(Utils)
                Utils.download_url("https://../secret.txt", os.path.join(tmp, "data"), "got.txt")
                self.assertEqual(Utils.calls, ["https://../secret.txt"])  # not served from outside the cache
                self.assertFalse(os.path.exists(os.path.join(tmp, "data", "got.txt")))
            finally:
                if old is None:
                    os.environ.pop("BJ_DOWNLOADS", None)
                else:
                    os.environ["BJ_DOWNLOADS"] = old

if __name__ == "__main__":
    unittest.main()


class AnimationStrip(unittest.TestCase):
    """An animation keeps a strip of its frames in time order (a PNG) beside its GIF, for the Assistant's vision model."""

    def test_an_animation_gets_a_frame_strip(self):
        import json

        from PIL import Image

        code = (
            "import numpy as np\n"
            "import matplotlib.pyplot as plt\n"
            "from matplotlib.animation import FuncAnimation\n"
            "fig, ax = plt.subplots()\n"
            "line, = ax.plot([], [])\n"
            "ax.set_xlim(0, 10); ax.set_ylim(-1, 1)\n"
            "x = np.linspace(0, 10, 100)\n"
            "def update(i):\n"
            "    line.set_data(x[: i * 5 + 2], np.sin(x[: i * 5 + 2]))\n"
            "    return line,\n"
            "anim = FuncAnimation(fig, update, frames=20, interval=50)\n"
        )
        with tempfile.TemporaryDirectory() as out:
            bj_capture.run_sync(code, out)
            with open(os.path.join(out, bj_capture.MANIFEST), encoding="utf-8") as f:
                items = json.load(f)["items"]
            anim = next(i for i in items if i.get("name", "").startswith("animation"))
            self.assertIn("gif", anim["files"])
            self.assertRegex(anim["files"]["strip"], r"^\d+\.png$")
            self.assertNotIn("png", anim["files"])  # still an animation, not a still image
            strip = Image.open(os.path.join(out, anim["files"]["strip"]))
            self.assertEqual(strip.format, "PNG")
            self.assertLessEqual(strip.width, bj_capture.STRIP_COLUMNS * bj_capture.STRIP_WIDTH)
            self.assertGreater(strip.height, 0)

    def test_a_still_gif_gets_no_strip(self):
        buf = io.BytesIO()
        from PIL import Image

        Image.new("RGB", (10, 10), "white").save(buf, format="GIF")
        self.assertIsNone(bj_capture._frame_strip(buf.getvalue()))


class IPythonStandIn(unittest.TestCase):
    """Where IPython isn't installed (the phone, the server), notebook code gets a stand-in. matplotlib
    reads IPython.version_info whenever it makes a figure: without it, plt.figure() failed with
    "module 'IPython' has no attribute 'version_info'" once anything had imported IPython."""

    def test_figures_work_with_the_stand_in(self):
        m = bj_capture._ipython_module("IPython")
        self.assertGreaterEqual(m.version_info[:2], (8, 24))
        real = sys.modules.get("IPython")
        sys.modules["IPython"] = m
        try:
            from matplotlib.backend_bases import FigureCanvasBase

            FigureCanvasBase._fix_ipython_backend2gui.cache_clear()
            fig = plt.figure(figsize=(2, 2))
            plt.close(fig)
        finally:
            if real is None:
                del sys.modules["IPython"]
            else:
                sys.modules["IPython"] = real


class NoDeadEnds(unittest.TestCase):
    """What would stop a cell with a bare error says what to do instead."""

    def test_input_says_put_the_value_in_the_code(self):
        with tempfile.TemporaryDirectory() as out:
            with self.assertRaises(EOFError) as e:
                bj_capture.run_sync("x = input('name? ')", out, "<exec>", {"__name__": "__main__"})
            self.assertIn("Put the value in the code", str(e.exception))

    def test_plotly_write_image_without_kaleido_shows_the_chart(self):
        try:
            import plotly.express as px  # noqa: F401
        except ImportError:
            self.skipTest("plotly isn't installed")
        with tempfile.TemporaryDirectory() as out:
            err = io.StringIO()
            old = sys.stderr
            sys.stderr = err
            try:
                bj_capture.run_sync("import plotly.express as px\npx.scatter(x=[1], y=[1]).write_image('p.png')", out, "<exec>", {"__name__": "__main__"})
            except Exception as e:  # Kaleido installed here: it really wrote the image
                if "aleido" in str(e):
                    raise
            finally:
                sys.stderr = old
            if "Kaleido" in err.getvalue():
                self.assertTrue(any(f.endswith(".json") for f in os.listdir(out)))


class NoProcesses(unittest.TestCase):
    """Android can't start processes (no sem_open): pools run in threads instead of failing."""

    def test_pools_become_thread_pools_where_processes_cant_start(self):
        import concurrent.futures
        import multiprocessing

        real_pool, real_ppe, real_check = multiprocessing.Pool, concurrent.futures.ProcessPoolExecutor, bj_capture._processes_work
        bj_capture._processes_work = lambda: False
        try:
            with tempfile.TemporaryDirectory() as out:
                g = {"__name__": "__main__"}
                bj_capture.run_sync(
                    "from multiprocessing import Pool\nfrom concurrent.futures import ProcessPoolExecutor\n"
                    "with Pool(2) as p: a = p.map(abs, [-1, -2])\n"
                    "with ProcessPoolExecutor(2) as ex: b = list(ex.map(abs, [-3]))",
                    out, "<exec>", g)
                self.assertEqual((g["a"], g["b"]), ([1, 2], [3]))
        finally:
            multiprocessing.Pool, concurrent.futures.ProcessPoolExecutor = real_pool, real_ppe
            bj_capture._processes_work = real_check
            os.environ.pop("JOBLIB_MULTIPROCESSING", None)


class DataLibrary(unittest.TestCase):
    """Server runs: BJ_DATA's files are fetched into the run's folder before the code starts."""

    def test_fetches_named_files_and_keeps_existing(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "src.csv")
            with open(src, "w") as f:
                f.write("a,b\n1,2\n")
            work = os.path.join(d, "work")
            os.makedirs(work)
            with open(os.path.join(work, "kept.csv"), "w") as f:
                f.write("mine")
            os.environ["BJ_DATA"] = json.dumps([{"name": "iris.csv", "url": "file://" + src}, {"name": "kept.csv", "url": "file://" + src}, {"name": "../evil.csv", "url": "file://" + src}])
            try:
                bj_capture._fetch_library(work)
            finally:
                os.environ.pop("BJ_DATA", None)
            with open(os.path.join(work, "iris.csv")) as f:
                self.assertEqual(f.read(), "a,b\n1,2\n")
            with open(os.path.join(work, "kept.csv")) as f:
                self.assertEqual(f.read(), "mine")
            self.assertFalse(os.path.exists(os.path.join(d, "evil.csv")))  # names stay in the run's folder

    def test_a_failed_file_is_reported_not_fatal(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            os.environ["BJ_DATA"] = json.dumps([{"name": "gone.csv", "url": "file:///nope/gone.csv"}])
            err = io.StringIO()
            real, sys.stderr = sys.stderr, err
            try:
                bj_capture._fetch_library(d)
            finally:
                sys.stderr = real
                os.environ.pop("BJ_DATA", None)
            self.assertIn("Couldn't get gone.csv from your Data library", err.getvalue())


class SaveData(unittest.TestCase):
    """save_data(): a file the cell made goes to the Data library: listed in the manifest for the app
    (browser, phone), or uploaded at once to the slot the app signed (server, BJ_SAVE)."""

    def run_in(self, d, code):
        old = os.getcwd()
        os.chdir(d)
        try:
            return bj_capture.run_sync(code, os.path.join(d, "out"), "<t>", {"__name__": "__main__"})
        finally:
            os.chdir(old)

    def test_lists_the_file_for_the_app(self):
        with tempfile.TemporaryDirectory() as d:
            m = self.run_in(d, "open('raw.h5', 'wb').write(b'x' * 10)\nsave_data('raw.h5', name='N87.h5')")
            self.assertEqual([s["name"] for s in m["saved"]], ["N87.h5"])
            self.assertEqual(open(m["saved"][0]["path"], "rb").read(), b"x" * 10)

    def test_no_save_no_key_and_bad_names_fail_plainly(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertNotIn("saved", self.run_in(d, "print(1)"))
            with self.assertRaises(Exception) as e:
                self.run_in(d, "save_data('missing.csv')")
            self.assertIn("there's no file", str(e.exception))
            with self.assertRaises(Exception) as e:
                self.run_in(d, "open('a.csv', 'w').write('1')\nsave_data('a.csv', name='no extension')")
            self.assertIn("can't be a library name", str(e.exception))

    def test_server_uploads_to_its_slot(self):
        import http.server, threading
        got = {}

        class H(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                got["path"] = self.path
                got["upsert"] = self.headers.get("x-upsert")
                got["body"] = self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}/object/upload/sign/datasets/u/clean.csv?token=t"
        os.environ["BJ_SAVE"] = json.dumps([{"name": "clean.csv", "url": url}])
        try:
            with tempfile.TemporaryDirectory() as d:
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    m = self.run_in(d, "open('c.csv', 'w').write('a,b\\n1,2\\n')\nsave_data('c.csv', name='clean.csv')")
                self.assertNotIn("saved", m)
                self.assertEqual(got["body"], b"a,b\n1,2\n")
                self.assertEqual(got["upsert"], "true")
                self.assertIn("Saved clean.csv to your Data library", out.getvalue())
                with self.assertRaises(Exception) as e:
                    self.run_in(d, "open('o.csv', 'w').write('1')\nsave_data('o.csv')")
                self.assertIn("give the name as plain text", str(e.exception))
        finally:
            del os.environ["BJ_SAVE"]
            srv.shutdown()


class Logging(unittest.TestCase):
    """log(): scalar metrics and settings recorded in the run's manifest, as plain JSON values."""

    def run_code(self, code):
        with tempfile.TemporaryDirectory() as d:
            return bj_capture.run_sync(code, d, "<t>", {"__name__": "__main__"})

    def test_records_numbers_text_and_flags_in_order(self):
        m = self.run_code("log(accuracy=0.961, lr=0.01, epochs=20, model='mlp', ok=True)\nlog({'f1': 0.93})")
        self.assertEqual(list(m["logged"].items()), [("accuracy", 0.961), ("lr", 0.01), ("epochs", 20), ("model", "mlp"), ("ok", True), ("f1", 0.93)])

    def test_numpy_scalars_become_plain_values(self):
        m = self.run_code("import numpy as np\nlog(a=np.float64(0.5), b=np.int64(3), c=np.bool_(True), d=np.float32(0.25))")
        self.assertEqual(m["logged"], {"a": 0.5, "b": 3, "c": True, "d": 0.25})
        self.assertEqual({k: type(v) for k, v in m["logged"].items()}, {"a": float, "b": int, "c": bool, "d": float})

    def test_skips_arrays_and_non_finite_with_a_note(self):
        m = self.run_code("import numpy as np\nlog(x=np.array([1, 2]), y=float('nan'), z=1.0)")
        self.assertEqual(m["logged"], {"z": 1.0})
        self.assertTrue(any("log(x=…) was skipped" in n for n in m["notes"]))

    def test_later_value_wins_and_no_log_means_no_key(self):
        self.assertEqual(self.run_code("log(loss=1.0)\nlog(loss=0.4)")["logged"], {"loss": 0.4})
        self.assertNotIn("logged", self.run_code("print(1)"))
