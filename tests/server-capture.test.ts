// The server's Python command (buildCommand) runs bj_capture.py for real here, with
// the host's python3 (standard library only), as the Modal sandbox does: sourceFiles
// written into the work directory, then the command run there.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifest } from "@/lib/run/outputs";
import { serverOutputs } from "@/lib/run/server-client";
import { buildCommand, parseDirectives, serverErrorLine, SERVER_OUTPUT_BYTES, sourceFiles, splitBundle, WORKDIR } from "@/lib/run/server-languages";

const CAPTURE = readFileSync(join(__dirname, "../public/workers/bj_capture.py"), "utf8");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

function serverRun(code: string) {
  const cmd = buildCommand("python", parseDirectives("python", code));
  // The command cds into WORKDIR; give each test its own directory in its place.
  const dir = mkdtempSync(join(tmpdir(), "bj-"));
  for (const [name, text] of Object.entries(sourceFiles("python", code, CAPTURE))) writeFileSync(join(dir, name), text);
  const r = spawnSync(cmd[0]!, [cmd[1]!, cmd[2]!.replaceAll(WORKDIR, dir)], {
    env: { ...process.env, BJ_MAX_TOTAL_BYTES: String(SERVER_OUTPUT_BYTES) },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
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
  it("returns outputs whose bundle is far over 64 KiB whole, after long user lines", () => {
    const r = serverRun('print("y" * 100_000)\nopen("big.svg", "w").write("<svg xmlns=\'http://www.w3.org/2000/svg\'>" + "<g/>" * 50_000 + "</svg>")\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("y".repeat(100_000) + "\n");
    const out = serverOutputs(r.outputs);
    expect(new TextDecoder().decode(out!.files["0.svg"]).length).toBe(40 + 4 * 50_000 + 6);
  });
  it("reports errors at the user's line, without the capture's frames", () => {
    const r = serverRun('print("a")\nx = 1 / 0\n');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("a\n");
    expect(r.stderr).toContain('File "main.py", line 2');
    expect(r.stderr).not.toContain("bj_capture");
    expect(serverErrorLine("python", r.stderr)).toBe(2);
  });
  it("lets the code call asyncio.run itself, and still supports top-level await", () => {
    expect(serverRun("import asyncio\nasync def m():\n    return 5\nprint(asyncio.run(m()))\n").stdout).toBe("5\n");
    expect(serverRun("import asyncio\nawait asyncio.sleep(0)\nprint('ok')\n").stdout).toBe("ok\n");
  });
  it("passes sys.exit codes through", () => {
    expect(serverRun("import sys\nsys.exit(3)\n").status).toBe(3);
  });
});
