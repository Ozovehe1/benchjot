// The server's Python command (buildCommand) runs bj_capture.py for real here, with
// the host's python3 (standard library only), as the Modal sandbox does.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifest } from "@/lib/run/outputs";
import { serverOutputs } from "@/lib/run/server-client";
import { buildCommand, parseDirectives, serverErrorLine, SERVER_OUTPUT_BYTES, splitBundle } from "@/lib/run/server-languages";

const CAPTURE = readFileSync(join(__dirname, "../public/workers/bj_capture.py"), "utf8");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

function serverRun(code: string) {
  const cmd = buildCommand("python", parseDirectives("python", code));
  // The command cds into /tmp/bj; give each test its own HOME-free copy of that path.
  const script = cmd[2]!.replaceAll("/tmp/bj", mkdtempSync(join(tmpdir(), "bj-")));
  const r = spawnSync(cmd[0]!, [cmd[1]!, script], {
    env: { ...process.env, BJ_CODE: code, BJ_CAPTURE: CAPTURE, BJ_MAX_TOTAL_BYTES: String(SERVER_OUTPUT_BYTES) },
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr, ...splitBundle(r.stdout) };
}

describe.skipIf(!hasPython)("server Python runs through bj_capture", () => {
  it("returns the user's stdout and the files the code wrote, in the contract", () => {
    const r = serverRun('print("hi")\nopen("plot.svg", "w").write("<svg xmlns=\'http://www.w3.org/2000/svg\'/>")\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("hi\n");
    const out = serverOutputs(r.outputs);
    expect(out && manifest.safeParse(out.manifest).success).toBe(true);
    expect(out?.manifest.items[0]).toMatchObject({ kind: "image", source: "file", name: "plot.svg", files: { svg: "0.svg" } });
    expect(new TextDecoder().decode(out!.files["0.svg"])).toContain("<svg");
  });
  it("reports errors at the user's line, without the capture's frames", () => {
    const r = serverRun('print("a")\nx = 1 / 0\n');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("a\n");
    expect(r.stderr).toContain('File "main.py", line 2');
    expect(r.stderr).not.toContain("bj_capture");
    expect(serverErrorLine("python", r.stderr)).toBe(2);
  });
  it("passes sys.exit codes through", () => {
    expect(serverRun("import sys\nsys.exit(3)\n").status).toBe(3);
  });
});
