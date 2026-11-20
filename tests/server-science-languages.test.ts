// R and MATLAB (GNU Octave) cells on the server, run for real when the host has Rscript / octave
// (the app's own files and command, as the Modal sandbox runs them); Julia and the images are
// checked by shape. The real runs are skipped where the programs aren't installed (CI).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifest } from "@/lib/run/outputs";
import { serverOutputs } from "@/lib/run/server-client";
import { buildCommand, capturesOutputs, finishRun, imageLayers, IMAGES, parseDirectives, runsOnServer, SERVER_LANGUAGES, sourceFiles, WORKDIR, type ServerLanguageId } from "@/lib/run/server-languages";

const CAPTURE = readFileSync(join(__dirname, "../public/workers/bj_capture.py"), "utf8");
const has = (bin: string) => spawnSync(bin, ["--version"]).status === 0;

function serverRun(language: ServerLanguageId, code: string) {
  const cmd = buildCommand(language, parseDirectives(language, code));
  const dir = mkdtempSync(join(tmpdir(), "bj-"));
  for (const [name, text] of Object.entries(sourceFiles(language, code, CAPTURE))) writeFileSync(join(dir, name), text);
  const r = spawnSync(cmd[0]!, [cmd[1]!, cmd[2]!.replaceAll(WORKDIR, dir)], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return finishRun({ language, gpu: null, network: "datasets" }, r.stdout, r.stderr, r.status ?? 1, 1);
}
const images = (r: ReturnType<typeof serverRun>) => {
  const out = serverOutputs(r.outputs);
  if (out) expect(manifest.safeParse(out.manifest).success).toBe(true);
  return out?.manifest.items.map((i) => ("name" in i ? i.name : "")) ?? [];
};

describe("R, MATLAB and Julia run on the server", () => {
  it("each has an image with python3 (for the figure capture) and its support file", () => {
    for (const lang of ["r", "matlab", "julia"] as const) {
      expect(runsOnServer(lang)).toBe(true);
      expect(capturesOutputs(lang)).toBe(true);
      const layers = imageLayers(SERVER_LANGUAGES[lang].image).flat().join("\n");
      expect(layers).toContain("python3");
      expect(buildCommand(lang, { timeoutSec: 60 })[2]).toContain("python3 bj_capture.py --collect out -- ");
    }
    expect(Object.keys(sourceFiles("r", "x <- 1", "C"))).toEqual(["main.R", "bj_capture.py", ".Rprofile"]);
    expect(Object.keys(sourceFiles("matlab", "x = 1;", "C"))).toEqual(["main.m", "bj_capture.py", "bj_run.m"]);
    expect(Object.keys(sourceFiles("julia", "x = 1", "C"))).toEqual(["main.jl", "bj_capture.py", "bj_run.jl"]);
    expect(IMAGES.julia).toMatch(/^julia:/);
    expect(imageLayers("gcc")).toEqual([]);
    // What Octave needed to write a PNG when run for real: gnuplot, Ghostscript and the FreeSans font.
    for (const pkg of ["gnuplot-nox", "ghostscript", "fonts-freefont-otf"]) expect(imageLayers("octave").flat().join(" ")).toContain(pkg);
  });

  it("their directives use their own comment sign", () => {
    expect(parseDirectives("r", "# timeout: 30\nx <- 1").timeoutSec).toBe(30);
    expect(parseDirectives("matlab", "% timeout: 30\nx = 1;").timeoutSec).toBe(30);
    expect(parseDirectives("julia", "# network: on").network).toBe("on");
    expect(() => parseDirectives("r", "# gpu: T4")).toThrow(/Python only/);
  });
});

describe.skipIf(!has("Rscript"))("R, for real", () => {
  it("prints output and returns each plot as a figure", () => {
    const r = serverRun("r", 'x <- c(1, 2, 3, 4)\ncat("mean", mean(x), "\\n")\nplot(x, x^2, main = "squares")\nhist(x)\n');
    expect(r.outcome).toBe("ok");
    expect(r.stdout).toBe("mean 2.5 \n");
    expect(images(r)).toEqual(["figure-1.png", "figure-2.png"]);
  }, 60_000);
  it("an error is an error, with the plots made before it", () => {
    const r = serverRun("r", 'plot(1:3)\nstop("boom on purpose")\n');
    expect(r.outcome).toBe("error");
    expect(r.stderr).toContain("boom on purpose");
    expect(images(r)).toEqual(["figure-1.png"]);
  }, 60_000);
});

describe.skipIf(!has("octave"))("MATLAB cells on GNU Octave, for real", () => {
  it("prints output and saves every open figure, with no toolkit warning", () => {
    const r = serverRun("matlab", "t = linspace(0, 1, 50);\nfprintf('max = %.1f\\n', max(t));\nfigure; plot(t, t.^2); title('squares');\nfigure; plot(t, sin(t));\n");
    expect(r.stderr).toBe("");
    expect(r.outcome).toBe("ok");
    expect(r.stdout).toBe("max = 1.0\n");
    expect(images(r)).toEqual(["figure-1.png", "figure-2.png"]);
  }, 120_000);
  it("an error names its line in the cell", () => {
    const r = serverRun("matlab", "x = 1;\ny = undefined_thing + 1;\n");
    expect(r.outcome).toBe("error");
    expect(r.stderr).toContain("'undefined_thing' undefined");
    expect(r.line).toBe(2);
  }, 120_000);
});
