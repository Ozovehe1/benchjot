import { describe, expect, it } from "vitest";
import { buildCommand, capOutput, DirectiveError, LIMITS, outcomeOf, parseDirectives, runsOnServer, serverErrorLine, SERVER_LANGUAGES } from "@/lib/run/server-languages";
import { toRunResult } from "@/lib/run/server-client";
import { LANGUAGE_IDS } from "@/lib/languages";

describe("server languages", () => {
  it("covers Python, C, C++, Go, Rust and Java, all known to the editor", () => {
    for (const id of ["python", "c", "cpp", "go", "rust", "java"]) expect(runsOnServer(id)).toBe(true);
    expect(runsOnServer("javascript")).toBe(false);
    for (const id of Object.keys(SERVER_LANGUAGES)) expect(LANGUAGE_IDS).toContain(id);
  });
});

describe("parseDirectives", () => {
  it("defaults to no packages, no GPU, the default timeout", () => {
    expect(parseDirectives("python", "print(1)")).toEqual({ packages: [], gpu: null, timeoutSec: LIMITS.timeoutSec.default });
  });
  it("reads pip, gpu and timeout comments", () => {
    const d = parseDirectives("python", "# pip: torch transformers==4.46.0, scikit-learn\n# GPU: t4\n# timeout: 120s\nimport torch\n");
    expect(d).toEqual({ packages: ["torch", "transformers==4.46.0", "scikit-learn"], gpu: "T4", timeoutSec: 120 });
  });
  it("uses the language's own comment token", () => {
    expect(parseDirectives("c", "// timeout: 30\nint main(){}").timeoutSec).toBe(30);
    expect(parseDirectives("c", "# timeout: 30\nint main(){}").timeoutSec).toBe(LIMITS.timeoutSec.default);
  });
  it("rejects unsafe packages, unknown GPUs, out-of-range timeouts and pip outside Python", () => {
    expect(() => parseDirectives("python", "# pip: numpy; rm -rf /")).toThrow(DirectiveError);
    expect(() => parseDirectives("python", "# pip: $(whoami)")).toThrow(DirectiveError);
    expect(() => parseDirectives("python", "# gpu: H9000")).toThrow(DirectiveError);
    expect(() => parseDirectives("python", "# timeout: 9999")).toThrow(DirectiveError);
    expect(() => parseDirectives("go", "// pip: numpy")).toThrow(DirectiveError);
  });
});

describe("buildCommand", () => {
  it("passes code through the environment, never the command line", () => {
    const [sh, flag, script] = buildCommand("python", { packages: [], gpu: null, timeoutSec: 60 });
    expect([sh, flag]).toEqual(["sh", "-c"]);
    expect(script).toContain(`printf '%s' "$BJ_CODE" > main.py`);
    expect(script).toContain("timeout -s TERM 60s");
    expect(script).not.toContain("pip install");
  });
  it("installs quoted packages before running, and compiles C before running it", () => {
    expect(buildCommand("python", { packages: ["torch"], gpu: "T4", timeoutSec: 60 })[2]).toContain("pip install -q --disable-pip-version-check --root-user-action=ignore '\\''torch'\\''");
    expect(buildCommand("c", { packages: [], gpu: null, timeoutSec: 60 })[2]).toContain("gcc -O2 -std=c17 -o main main.c -lm && ./main");
  });
});

describe("serverErrorLine", () => {
  it("takes the last traceback frame in Python and the first compiler error elsewhere", () => {
    const tb = 'Traceback (most recent call last):\n  File "/tmp/bj/main.py", line 7, in <module>\n    f()\n  File "/tmp/bj/main.py", line 3, in f\nZeroDivisionError';
    expect(serverErrorLine("python", tb)).toBe(3);
    expect(serverErrorLine("c", "main.c:4:5: error: x\nmain.c:9:1: error: y")).toBe(4);
    expect(serverErrorLine("rust", "error[E0425]\n --> main.rs:2:13")).toBe(2);
    expect(serverErrorLine("java", "Main.java:5: error: ';' expected")).toBe(5);
    expect(serverErrorLine("go", "no line here")).toBeNull();
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
