import { describe, expect, it } from "vitest";
import { buildCommand, capOutput, DirectiveError, LIMITS, outcomeOf, parseDirectives, PYTHON_PREINSTALLED, PYTHON_PREINSTALLED_NAMES, pythonImageLayers, RESPONSE_LIMIT_BYTES, runsOnServer, sandboxNetwork, serverErrorLine, SERVER_LANGUAGES, SERVER_OUTPUT_BYTES, sourceFiles, WORKDIR, withNetworkHint, NETWORK_HINT, NETWORK_OFF_HINT, DATASET_HOSTS, datasetEnv, isDatasetHost, finishRun, collapseCarriageReturns, cacheEnv, cacheVolumeName, CACHE_DIR, imageLayers, IMAGES, autoInstallNote, quietLibraryLogs } from "@/lib/run/server-languages";
import { toRunResult } from "@/lib/run/server-client";
import { LANGUAGE_IDS } from "@/lib/code/languages";

describe("server languages", () => {
  it("covers Python, R, Julia, MATLAB (Octave), C, C++ and Fortran, all known to the editor", () => {
    for (const id of ["python", "r", "julia", "matlab", "c", "cpp", "fortran"]) expect(runsOnServer(id)).toBe(true);
    for (const id of ["javascript", "go", "rust", "java"]) expect(runsOnServer(id)).toBe(false);
    expect(Object.keys(SERVER_LANGUAGES).sort()).toEqual(["c", "cpp", "fortran", "julia", "matlab", "python", "r"]);
    for (const id of Object.keys(SERVER_LANGUAGES)) expect(LANGUAGE_IDS).toContain(id);
  });
});

describe("parseDirectives", () => {
  it("defaults to no packages, no GPU, the default timeout", () => {
    expect(parseDirectives("python", "print(1)")).toEqual({ packages: [], gpu: null, gpuChoice: "auto", timeoutSec: LIMITS.timeoutSec.default, timeoutSet: false, network: "datasets", auto: [] });
  });
  it("reads pip, gpu and timeout comments", () => {
    const d = parseDirectives("python", "# pip: torch transformers==4.46.0, scikit-learn\n# GPU: t4\n# timeout: 120s\nimport torch\n");
    expect(d).toEqual({ packages: ["torch", "transformers==4.46.0", "scikit-learn"], gpu: "T4", gpuChoice: "cell", timeoutSec: 120, timeoutSet: true, network: "datasets", auto: [] });
  });
  it("network: dataset hosts by default; on, off, datasets, or a list of domains (any language)", () => {
    expect(parseDirectives("python", "# network: on").network).toBe("on");
    expect(parseDirectives("python", "# network: datasets").network).toBe("datasets");
    expect(parseDirectives("python", "# network: off").network).toBe("off");
    expect(parseDirectives("python", "# Network: OFF").network).toBe("off");
    expect(parseDirectives("python", "# network: huggingface.co, *.hf.co storage.googleapis.com").network).toEqual({ domains: ["huggingface.co", "*.hf.co", "storage.googleapis.com"] });
    expect(parseDirectives("r", "# network: on").network).toBe("on");
    for (const bad of ["# network: http://x.com", "# network: x.com/path", "# network: localhost", "# network: 10.0.0.1", "# network: a.com; rm -rf /"]) {
      expect(() => parseDirectives("python", bad)).toThrow(DirectiveError);
    }
    const many = Array.from({ length: LIMITS.maxDomains + 1 }, (_, i) => `d${i}.com`).join(" ");
    expect(() => parseDirectives("python", `# network: ${many}`)).toThrow(DirectiveError);
  });
  it("gpu: none / cpu force the CPU, auto leaves it to the detector", () => {
    expect(parseDirectives("python", "# gpu: none")).toMatchObject({ gpu: null, gpuChoice: "cell" });
    expect(parseDirectives("python", "# gpu: CPU")).toMatchObject({ gpu: null, gpuChoice: "cell" });
    expect(parseDirectives("python", "# gpu: auto")).toMatchObject({ gpu: null, gpuChoice: "auto" });
    expect(() => parseDirectives("python", "# gpu: maybe")).toThrow(/auto, none or one of/);
  });
  it("uses the language's own comment token (# for R too)", () => {
    expect(parseDirectives("r", "# timeout: 30\nx <- 1").timeoutSec).toBe(30);
    expect(parseDirectives("r", "// timeout: 30\nx <- 1").timeoutSec).toBe(LIMITS.timeoutSec.default);
  });
  it("rejects unsafe packages, unknown GPUs, out-of-range timeouts and pip outside Python", () => {
    expect(() => parseDirectives("python", "# pip: numpy; rm -rf /")).toThrow(DirectiveError);
    expect(() => parseDirectives("python", "# pip: $(whoami)")).toThrow(DirectiveError);
    expect(() => parseDirectives("python", "# gpu: H9000")).toThrow(DirectiveError);
    expect(() => parseDirectives("python", "# timeout: 9999")).toThrow(DirectiveError);
    expect(() => parseDirectives("r", "# pip: numpy")).toThrow(DirectiveError);
  });
});

describe("buildCommand", () => {
  it("runs the files in WORKDIR; the code is never on the command line", () => {
    const [sh, flag, script] = buildCommand("python", { timeoutSec: 60 });
    expect([sh, flag]).toEqual(["sh", "-c"]);
    expect(script).toBe(`cd ${WORKDIR} && exec timeout -s TERM 60s sh -c 'python3 -u bj_capture.py main.py out'`);
  });
  it("writes the code (any allowed size) and Python's capture module as files", () => {
    const code = "x".repeat(LIMITS.maxCodeChars); // over Linux's 128 KiB limit for one environment variable
    expect(sourceFiles("python", code, "CAPTURE")).toEqual({ "main.py": code, "bj_capture.py": "CAPTURE" });
    expect(sourceFiles("r", "x <- 1", "CAPTURE")).toMatchObject({ "main.R": "x <- 1", "bj_capture.py": "CAPTURE" });
  });
  it("never installs at run time (packages are in the image); R runs under the figure capture", () => {
    expect(buildCommand("python", { timeoutSec: 60 })[2]).not.toContain("pip");
    expect(buildCommand("r", { timeoutSec: 60 })[2]).toContain("python3 bj_capture.py --collect out -- Rscript main.R");
  });
});

describe("quietLibraryLogs", () => {
  // The user's run (2026-11-18): TensorFlow on a CPU sandbox.
  const tf = [
    "WARNING: All log messages before absl::InitializeLog() is called are written to STDERR",
    "I0000 00:00:1794969688.554250       7 port.cc:153] oneDNN custom operations are on. You may see slightly different numerical results due to floating-point round-off errors from different computation orders. To turn them off, set the environment variable `TF_ENABLE_ONEDNN_OPTS=0`.",
    "W0000 00:00:1794969691.235843       7 gpu_device.cc:2341] Cannot dlopen some GPU libraries.",
    "E0000 00:00:1794969692.672024       7 cuda_platform.cc:52] failed call to cuInit: INTERNAL: CUDA error: Failed call to cuInit: UNKNOWN ERROR (303)",
  ];
  it("drops TensorFlow's startup chatter on a CPU run", () => {
    expect(quietLibraryLogs(tf.join("\n") + "\n", false)).toBe(""); // nothing left: no empty stderr shown
  });
  it("keeps the CUDA probe when a GPU was asked for (then it's a real problem)", () => {
    expect(quietLibraryLogs(tf.join("\n"), true)).toBe(tf[3]);
  });
  it("never touches tracebacks, the user's own output or other errors", () => {
    const real = [
      "Traceback (most recent call last):",
      '  File "/tmp/bj/main.py", line 3, in <module>',
      "ValueError: I0000 is not a number",
      "E0000 00:00:1.0       7 op_kernel.cc:1857] OP_REQUIRES failed: Incompatible shapes",
      "WARNING: my own warning",
    ].join("\n");
    expect(quietLibraryLogs(real, false)).toBe(real);
  });
});

describe("the user's download cache", () => {
  it("one volume per user, named by their id; nothing for an id that isn't one", () => {
    expect(cacheVolumeName("9F000000-0000-4000-8000-0000000000A1")).toBe("bj-cache-9f000000-0000-4000-8000-0000000000a1");
    for (const bad of ["", "../other", "bj-cache-x", "9f000000-0000-4000-8000-0000000000a1/.."]) expect(cacheVolumeName(bad)).toBeNull();
  });
  it("points the loaders' caches at it; Keras keeps the image's", () => {
    const env = cacheEnv();
    for (const k of ["HF_HOME", "TORCH_HOME", "SCIKIT_LEARN_DATA", "SEABORN_DATA", "NLTK_DATA", "TFDS_DATA_DIR", "XDG_CACHE_HOME", "BJ_DOWNLOADS"]) expect(env[k]).toMatch(new RegExp(`^${CACHE_DIR}/`));
    expect(env.KERAS_HOME).toBeUndefined();
  });
});

describe("collapseCarriageReturns", () => {
  it("keeps only a progress bar's last redraw (the user's CIFAR-10 download, 2026-11-18)", () => {
    const bar = "  0%|          | 0.00/170M [00:00<?, ?B/s]\r  1%|          | 1.05M/170M [00:03<08:43, 323kB/s]\r100%|██████████| 170M/170M [07:07<00:00, 399kB/s]\n";
    expect(collapseCarriageReturns("epoch 1\n" + bar + "done\n")).toBe("epoch 1\n100%|██████████| 170M/170M [07:07<00:00, 399kB/s]\ndone\n");
  });
  it("leaves ordinary output and Windows line ends alone", () => {
    expect(collapseCarriageReturns("a\nb\n")).toBe("a\nb\n");
    expect(collapseCarriageReturns("a\r\nb\r\n")).toBe("a\nb\n");
    expect(finishRun({ language: "python", gpu: null, network: "datasets" }, "x\ry\n", "1%\r100%\n", 0, 1)).toMatchObject({ stdout: "y\n", stderr: "100%\n" });
  });
});

describe("auto-installed imports", () => {
  it("installs what the cell imports and the image lacks, by PyPI name, with the # pip: ones", () => {
    const code = "# pip: einops\nimport os, numpy as np\nimport torch\nfrom sklearn_extra.cluster import KMedoids\nimport gymnasium\nimport einops\nimport my_typo_pkg\n";
    expect(parseDirectives("python", code).auto).toEqual(["scikit-learn-extra", "my_typo_pkg"]);
  });
  it("never for other languages, and within the package limit", () => {
    expect(parseDirectives("r", "# import foo\nlibrary(dplyr)").auto).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `import pkg_${i}`).join("\n");
    expect(parseDirectives("python", many).auto).toHaveLength(LIMITS.maxPackages);
  });
  it("names them when they can't be installed", () => {
    expect(autoInstallNote(["my_typo_pkg"])).toMatch(/Couldn't install my_typo_pkg from PyPI on the server, so the code ran without it/);
  });
});

describe("the Python image", () => {
  it("preinstalls deep learning, data science and simulation libraries, pinned", () => {
    for (const name of ["tensorflow", "keras", "torch", "jax", "scikit-learn", "xgboost", "pandas", "statsmodels", "simpy", "mesa", "numba", "sympy", "matplotlib", "plotly"]) {
      expect(PYTHON_PREINSTALLED_NAMES).toContain(name);
    }
    for (const p of PYTHON_PREINSTALLED) expect(p).toMatch(/==/);
  });
  it("is the base layer, plus one sorted layer for the cell's # pip: packages", () => {
    const [base, system, datasets, ...rest] = pythonImageLayers();
    expect(rest).toEqual([]);
    // Slow-hosted datasets kept in the image; a failed download at build time never fails the image.
    expect(datasets!.join(" ")).toContain("/opt/bj-datasets/");
    for (const c of datasets!) expect(c.endsWith("|| true")).toBe(true);
    // After the packages, so changing it doesn't reinstall them: ffmpeg (animations as MP4) and the server's animation limits.
    expect(system!.join(" ")).toMatch(/BJ_ANIMATION_FRAMES=600.*apt-get install.*ffmpeg/);
    expect(base!.at(-1)).toMatch(/^RUN pip install --no-cache-dir 'numpy==/);
    expect(base).toContain("ENV TF_CPP_MIN_LOG_LEVEL=2");
    expect(pythonImageLayers(["gymnasium", "einops", "gymnasium"])[3]).toEqual(["RUN pip install --no-cache-dir 'einops' 'gymnasium'"]);
    expect(pythonImageLayers(["b", "a"])).toEqual(pythonImageLayers(["a", "b"]));
  });
  it("scripts/modal-image.mjs prebuilds exactly the same layers", async () => {
    // @ts-expect-error plain JS script
    const { layers } = (await import("../scripts/modal-image.mjs")) as { layers: (spec: unknown, p?: string[]) => string[][] };
    const spec = (await import("@/lib/run/python-image.json")).default;
    expect(layers(spec)).toEqual(pythonImageLayers());
    expect(layers(spec, ["z", "a"])).toEqual(pythonImageLayers(["z", "a"]));
  });
  it("a failed download says how to reach the site", () => {
    const err = "urllib.error.URLError: <urlopen error [Errno -3] Temporary failure in name resolution>";
    expect(withNetworkHint(err, 1, "datasets")).toBe(err + NETWORK_HINT);
    expect(withNetworkHint(err, 1, { domains: ["a.org"] })).toBe(err + NETWORK_HINT);
    expect(withNetworkHint(err, 1, "off")).toBe(err + NETWORK_OFF_HINT);
    expect(withNetworkHint(err, 1, "on")).toBe(err);
    expect(withNetworkHint(err, 0, "datasets")).toBe(err);
    expect(withNetworkHint("ZeroDivisionError", 1, "datasets")).toBe("ZeroDivisionError");
  });
  it("by default the sandbox reaches the dataset hosts only; every host is a valid allowlist note", () => {
    expect(sandboxNetwork("datasets")).toEqual({ outboundDomainAllowlist: [...DATASET_HOSTS] });
    for (const h of ["storage.googleapis.com", "www.cs.toronto.edu", "download.pytorch.org", "*.openml.org", "ndownloader.figshare.com", "raw.githubusercontent.com", "huggingface.co", "*.hf.co"]) expect(DATASET_HOSTS).toContain(h);
    for (const h of DATASET_HOSTS) expect(parseDirectives("python", `# network: ${h}`).network).toEqual({ domains: [h] }); // each passes the domain check
  });
  it("scripts/modal-image.mjs prebuilds the R, Octave and Julia images exactly as runs use them", async () => {
    // @ts-expect-error plain JS script
    const { otherImages } = (await import("../scripts/modal-image.mjs")) as { otherImages: () => { id: "r" | "octave" | "julia"; base: string; layers: string[][] }[] };
    const built = otherImages();
    expect(built.map((b) => b.id).sort()).toEqual(["julia", "octave", "r"]);
    for (const b of built) {
      expect(b.base).toBe(IMAGES[b.id]);
      expect(b.layers).toEqual(imageLayers(b.id));
    }
  });
  it("Vercel builds the image in production deploys only, with the project's Modal tokens", async () => {
    // @ts-expect-error plain JS script
    const { shouldBuildOnVercel } = (await import("../scripts/modal-image.mjs")) as { shouldBuildOnVercel: (env: Record<string, string>) => { build: boolean } };
    const tokens = { MODAL_TOKEN_ID: "ak-x", MODAL_TOKEN_SECRET: "as-x" };
    expect(shouldBuildOnVercel({ VERCEL_ENV: "production", ...tokens }).build).toBe(true);
    expect(shouldBuildOnVercel({ VERCEL_ENV: "preview", ...tokens }).build).toBe(false);
    expect(shouldBuildOnVercel({ ...tokens }).build).toBe(false);
    expect(shouldBuildOnVercel({ VERCEL_ENV: "production" }).build).toBe(false);
  });
  it("the default network reaches where the dataset loaders end up, after their redirects (checked 2026-11-18)", () => {
    for (const host of [
      "www.cs.toronto.edu", "cave.cs.toronto.edu", // CIFAR: the user's failed run
      "ndownloader.figshare.com", "44c1cec316ec56bca76dfd65d2882b20.r2.cloudflarestorage.com", // fetch_california_housing
      "www.openml.org", "api.openml.org", "ossci-datasets.s3.amazonaws.com", "storage.googleapis.com", "download.pytorch.org",
      "ufldl.stanford.edu", "ai.stanford.edu", "downloads.cs.stanford.edu", "nlp.stanford.edu",
      "raw.githubusercontent.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com",
      "huggingface.co", "cas-bridge.xethub.hf.co", "drive.usercontent.google.com", "archive.ics.uci.edu",
    ]) expect(isDatasetHost(host), host).toBe(true);
    for (const host of ["example.com", "evil-stanford.edu", "cloudflarestorage.com", "githubusercontent.com.evil.io"]) expect(isDatasetHost(host), host).toBe(false);
  });

  it("the Hugging Face token becomes the variable Hugging Face's libraries read; only when set", () => {
    expect(datasetEnv({ hf_token: "hf_x" })).toEqual({ HF_TOKEN: "hf_x" });
    expect(datasetEnv({ hf_token: "" })).toEqual({});
    expect(datasetEnv(null)).toEqual({});
    expect(datasetEnv("x")).toEqual({});
  });
  it("a background run can always reach the app to send its result back, whatever the cell's network", () => {
    expect(sandboxNetwork("off", ["benchjot.vercel.app"])).toEqual({ outboundDomainAllowlist: ["benchjot.vercel.app"] });
    expect(sandboxNetwork({ domains: ["a.org"] }, ["benchjot.vercel.app"])).toEqual({ outboundDomainAllowlist: ["a.org", "benchjot.vercel.app"] });
    expect((sandboxNetwork("datasets", ["benchjot.vercel.app"]) as { outboundDomainAllowlist: string[] }).outboundDomainAllowlist).toContain("benchjot.vercel.app");
    expect(sandboxNetwork("on", ["benchjot.vercel.app"])).toEqual({});
  });
  it("finishRun: the same result for a run that waited and one that ran in the background", () => {
    const r = finishRun({ language: "python", gpu: null, network: "datasets", note: "[note]\n" }, "hi\n", 'Traceback\n  File "/tmp/bj/main.py", line 2, in <module>\nValueError', 1, 42);
    expect(r).toMatchObject({ outcome: "error", stdout: "hi\n", exitCode: 1, ms: 42, line: 2, outputs: null });
    expect(r.stderr.startsWith("[note]\n")).toBe(true);
    expect(finishRun({ language: "python", gpu: null, network: "datasets" }, "", "", 124, 5).outcome).toBe("timeout");
  });
  it("network maps to Modal's options: blocked, open, or an allowlist", () => {
    expect(sandboxNetwork("off")).toEqual({ blockNetwork: true });
    expect(sandboxNetwork("on")).toEqual({});
    expect(sandboxNetwork({ domains: ["huggingface.co"] })).toEqual({ outboundDomainAllowlist: ["huggingface.co"] });
  });
});

describe("serverErrorLine", () => {
  it("takes the last traceback frame in Python and R's first mention of its file", () => {
    const tb = 'Traceback (most recent call last):\n  File "/tmp/bj/main.py", line 7, in <module>\n    f()\n  File "/tmp/bj/main.py", line 3, in f\nZeroDivisionError';
    expect(serverErrorLine("python", tb)).toBe(3);
    expect(serverErrorLine("r", "Error in source(\"main.R\") : main.R:4:3: unexpected symbol")).toBe(4);
    expect(serverErrorLine("r", "no line here")).toBeNull();
  });
});

describe("response size", () => {
  it("fits the hosting limit with the outputs at their cap (base64) and both streams full", () => {
    const base64 = Math.ceil(SERVER_OUTPUT_BYTES / 3) * 4;
    const manifest = 300_000 + 20_000; // bj_capture's inline table budget (MAX_INLINE_CHARS) and item metadata
    expect(base64 + manifest + 2 * LIMITS.maxOutputChars + 1_000).toBeLessThan(RESPONSE_LIMIT_BYTES);
  });
});

describe("results", () => {
  it("maps exit codes to outcomes", () => {
    expect(outcomeOf(0)).toBe("ok");
    expect(outcomeOf(124)).toBe("timeout");
    expect(outcomeOf(1)).toBe("error");
  });
  it("keeps the tail of long output", () => {
    expect(capOutput("abcdef", 3)).toBe("[output truncated]\ndef");
  });
  it("shows stderr as the error on failure and as output on success", () => {
    const fail = toRunResult({ outcome: "error", stdout: "partial", stderr: "boom", exitCode: 1, ms: 5, line: 2 });
    expect(fail.chunks).toEqual([{ stream: "stdout", text: "partial" }]);
    expect(fail.result.error).toEqual({ text: "boom", line: 2 });
    const ok = toRunResult({ outcome: "ok", stdout: "1\n", stderr: "warn", exitCode: 0, ms: 5, line: null });
    expect(ok.chunks.map((c) => c.stream)).toEqual(["stdout", "stderr"]);
    expect(ok.result.error).toBeNull();
  });
});
