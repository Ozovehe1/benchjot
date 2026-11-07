"""bj_capture.py checks that need the real plotting libraries (CI's outputs job):
  python -m unittest tests/bj_capture_test.py"""
import io
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


if __name__ == "__main__":
    unittest.main()
