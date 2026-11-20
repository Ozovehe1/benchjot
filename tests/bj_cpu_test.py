"""GPU code on a machine without a GPU (bj_capture's converter): PyTorch written for CUDA runs on the
CPU, CuPy reads as NumPy / SciPy, and custom GPU kernels say plainly that they need a GPU.
Each case runs bj_capture the way the server does, in a fresh process. PyTorch cases skip where
PyTorch isn't installed."""

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CAPTURE = os.path.join(HERE, "..", "public", "workers", "bj_capture.py")
sys.path.insert(0, os.path.dirname(CAPTURE))
import bj_capture  # noqa: E402

try:
    import torch  # noqa: F401

    HAS_TORCH = not torch.cuda.is_available()
except ImportError:
    HAS_TORCH = False


def run(code):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "main.py")
        with open(path, "w") as f:
            f.write(textwrap.dedent(code))
        r = subprocess.run([sys.executable, CAPTURE, "main.py", "out"], cwd=d, capture_output=True, text=True, timeout=300)
        return r.returncode, r.stdout.split(bj_capture.BUNDLE_MARK)[0], r.stderr


class Torch(unittest.TestCase):
    @unittest.skipUnless(HAS_TORCH, "PyTorch (CPU) not installed")
    def test_cuda_training_loop_runs_on_the_cpu(self):
        code, out, err = run("""
            import torch, torch.nn as nn
            device = torch.device("cuda")
            model = nn.Sequential(nn.Linear(4, 8), nn.ReLU(), nn.Linear(8, 1)).cuda()
            x = torch.randn(64, 4, device="cuda")
            y = x.sum(1, keepdim=True).to(device)
            opt = torch.optim.SGD(model.parameters(), lr=0.05)
            scaler = torch.cuda.amp.GradScaler()
            for _ in range(100):
                with torch.autocast("cuda"):
                    loss = ((model(x) - y) ** 2).mean()
                opt.zero_grad(); scaler.scale(loss).backward(); scaler.step(opt); scaler.update()
            torch.cuda.synchronize(); torch.cuda.empty_cache()
            torch.save(model.state_dict(), "m.pt")
            model.load_state_dict(torch.load("m.pt", map_location="cuda:0"))
            print(next(model.parameters()).device, torch.zeros(2).to(0).device, loss.item() < 1)
        """)
        self.assertEqual(code, 0, err)
        self.assertEqual(out.strip(), "cpu cpu True")
        self.assertEqual(err.count(bj_capture.CPU_NOTE.strip()), 1)  # said once

    @unittest.skipUnless(HAS_TORCH, "PyTorch (CPU) not installed")
    def test_code_that_already_runs_on_the_cpu_is_left_alone(self):
        code, out, err = run("""
            import torch
            print(torch.ones(2, device="cpu").device, torch.ones(2).to(torch.float64).dtype)
        """)
        self.assertEqual((code, out.strip()), (0, "cpu torch.float64"), err)
        self.assertNotIn("[Benchjot]", err)


class CuPy(unittest.TestCase):
    def test_cupy_reads_as_numpy_and_scipy(self):
        code, out, err = run("""
            import cupy as cp
            import cupyx.scipy.ndimage as ndi
            a = cp.arange(6, dtype=cp.float32).reshape(2, 3)
            print(type(cp.asnumpy(a * 2)).__name__, cp.get_array_module(a).__name__, ndi.gaussian_filter(cp.ones((3, 3)), 1).shape)
            with cp.cuda.Device(0):
                print(float(cp.linalg.norm(cp.ones(4))), cp.cuda.runtime.getDeviceCount())
        """)
        self.assertEqual(code, 0, err)
        self.assertEqual(out.split(), ["ndarray", "numpy", "(3,", "3)", "2.0", "0"])
        self.assertIn(bj_capture.CPU_NOTE.strip(), err)

    def test_a_custom_cupy_kernel_says_it_needs_a_gpu(self):
        code, _, err = run("""
            import cupy as cp
            k = cp.RawKernel("extern \\"C\\" __global__ void f() {}", "f")
            k((1,), (1,), ())
        """)
        self.assertEqual(code, 1)
        self.assertIn("custom GPU kernel", err)


class Kernels(unittest.TestCase):
    def test_custom_kernel_errors_get_the_hint_and_others_dont(self):
        self.assertEqual(bj_capture.gpu_hint("numba.cuda.cudadrv.error.CudaSupportError: Error at driver init"), bj_capture.KERNEL_HINT)
        self.assertEqual(bj_capture.gpu_hint("RuntimeError: Found no NVIDIA driver on your system."), bj_capture.KERNEL_HINT)
        self.assertEqual(bj_capture.gpu_hint("ZeroDivisionError: division by zero"), "")


if __name__ == "__main__":
    unittest.main()
