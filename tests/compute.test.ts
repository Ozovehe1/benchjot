// The CPU / GPU detector (src/lib/run/compute.ts) on real cells: the ones the user ran
// (2026-11-18) and typical heavy ones.
import { describe, expect, it } from "vitest";
import { chooseCompute, computeNote } from "@/lib/run/compute";

const gpu = (code: string) => chooseCompute("python", code).gpu;

const KERAS_CIRCLE = `import numpy as np
import tensorflow as tf
from tensorflow import keras
X = np.random.default_rng(0).normal(size=(2000, 2))
model = keras.Sequential([keras.Input(shape=(2,)), keras.layers.Dense(16, activation="relu"), keras.layers.Dense(1, activation="sigmoid")])
model.compile(optimizer="adam", loss="binary_crossentropy")
history = model.fit(X, y, epochs=30, batch_size=64, verbose=0)`;

const TORCH_SINE = `import torch
x = torch.linspace(-3, 3, 200).unsqueeze(1)
net = torch.nn.Sequential(torch.nn.Linear(1, 32), torch.nn.Tanh(), torch.nn.Linear(32, 1))
opt = torch.optim.Adam(net.parameters(), lr=0.01)
for step in range(1500):
    loss = torch.nn.functional.mse_loss(net(x), y)
    opt.zero_grad(); loss.backward(); opt.step()`;

const CIFAR_CNN = `import torch, torchvision
from torch import nn
data = torchvision.datasets.CIFAR10(root=".", download=True)
model = nn.Sequential(nn.Conv2d(3, 32, 3), nn.ReLU(), nn.Flatten(), nn.LazyLinear(10))
for epoch in range(10):
    loss.backward()`;

describe("chooseCompute", () => {
  it("small deep learning jobs stay on the CPU (the user's Keras and PyTorch cells)", () => {
    expect(gpu(KERAS_CIRCLE)).toBeNull();
    expect(gpu(TORCH_SINE)).toBeNull();
    expect(chooseCompute("python", TORCH_SINE).reasons).toEqual(["deep learning, but a small job (faster on the CPU)"]);
  });

  it("no deep learning: never a GPU, however big", () => {
    const code = "import pandas as pd\nfrom sklearn.ensemble import RandomForestClassifier\nfor epoch in range(100):\n    m.fit(X, y)  # mnist cifar resnet";
    expect(chooseCompute("python", code)).toEqual({ gpu: null, reasons: ["no deep learning (a GPU wouldn't speed it up)"] });
  });

  it("a CNN on CIFAR-10 goes to a T4, with its reasons", () => {
    const c = chooseCompute("python", CIFAR_CNN);
    expect(c.gpu).toBe("T4");
    expect(c.reasons).toEqual(expect.arrayContaining(["convolutional layers", "an image dataset"]));
  });

  it("pretrained models go to a GPU; large ones to a bigger card", () => {
    expect(gpu("from transformers import AutoModel\nm = AutoModel.from_pretrained('bert-base-uncased')")).toBe("T4");
    expect(gpu("from transformers import AutoModelForCausalLM\nm = AutoModelForCausalLM.from_pretrained('mistralai/Mistral-7B-v0.1')")).toBe("A10G");
    expect(gpu("from transformers import pipeline\np = pipeline('text-generation', model='meta-llama/Llama-2-70b-hf')")).toBe("A100");
    expect(gpu("import torchvision\nm = torchvision.models.resnet50(weights='DEFAULT')")).toBe("T4");
  });

  it("code that uses the GPU itself always gets one", () => {
    expect(gpu("import torch\nx = torch.ones(3).cuda()")).toBe("T4");
    expect(gpu("import torch\ndev = torch.device('cuda')")).toBe("T4");
    expect(gpu("import xgboost as xgb\nm = xgb.XGBClassifier(tree_method='gpu_hist')")).toBe("T4");
    expect(gpu("import cupy as cp\nprint(cp.ones(3))")).toBe("T4");
  });

  it("comments aren't signals, and other languages stay on the CPU", () => {
    expect(gpu("import torch\n# x.cuda() would need a GPU; resnet50 later\nprint(1)")).toBeNull();
    expect(chooseCompute("c", "int main(){ /* cuda */ }")).toEqual({ gpu: null, reasons: [] });
  });
});

describe("computeNote", () => {
  const choice = { gpu: "T4" as const, reasons: ["convolutional layers", "an image dataset"] };
  it("says where it ran and how to change it; CPU choices say nothing", () => {
    expect(computeNote(choice)).toBe("[Benchjot] Ran on a T4 GPU (chosen automatically: convolutional layers, an image dataset). Add # gpu: none to use the CPU.\n");
    expect(computeNote({ gpu: null, reasons: ["x"] })).toBe("");
  });
});
