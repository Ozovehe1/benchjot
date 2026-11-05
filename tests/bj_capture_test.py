"""bj_capture.py checks that need the real plotting libraries (CI's outputs job):
  python -m unittest tests/bj_capture_test.py"""
import io
import os
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

    def test_captured_3d_figure_saves_every_format(self):
        with tempfile.TemporaryDirectory() as d:
            code = "import matplotlib.pyplot as plt\nimport numpy as np\n" + "fig = plt.figure(figsize=(8, 6))\nax = fig.add_subplot(projection='3d')\nax.set_zlabel('log10 loss')\nax.view_init(35, -60)\nplt.show()\n"
            m = bj_capture.run_sync(code, d)
            self.assertEqual([i["kind"] for i in m["items"]], ["image"])
            self.assertEqual(sorted(os.listdir(d)), ["0.pdf", "0.png", "0.svg", "manifest.json"])


if __name__ == "__main__":
    unittest.main()
