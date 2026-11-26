#!/usr/bin/env node
// Builds the server's Python image on Modal ahead of time (npm run modal:image), so the first
// "Run on server" after a change to src/lib/run/python-image.json doesn't spend its 300 s building
// TensorFlow / PyTorch. Modal caches layers by their commands, so a rerun with no change is quick.
// Optional extra arguments prebuild a `# pip:` layer too: npm run modal:image -- gymnasium pygame
//
//   MODAL_TOKEN_ID=ak-... MODAL_TOKEN_SECRET=as-... npm run modal:image
//
// With --on-vercel (npm run build's postbuild) it runs only in Vercel's production builds, with the
// project's own MODAL_TOKEN_ID / MODAL_TOKEN_SECRET, and never fails the deploy: a build error is a
// warning in the build log (the first server run then builds the image instead).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const spec = JSON.parse(readFileSync(new URL("../src/lib/run/python-image.json", import.meta.url), "utf8"));
const others = JSON.parse(readFileSync(new URL("../src/lib/run/server-images.json", import.meta.url), "utf8"));
const APP_NAME = "benchjot-runs"; // src/lib/server/modal.ts

/** The R, Octave and Julia images as imageLayers in src/lib/run/server-languages.ts builds them: one layer per command. */
export function otherImages(spec = others) {
  return Object.entries(spec)
    .filter(([, v]) => v && typeof v === "object" && v.base)
    .map(([id, v]) => ({ id, base: v.base, layers: (v.commands ?? []).map((c) => [c]) }));
}

/** The same layers as pythonImageLayers in src/lib/run/server-languages.ts (tests/server-languages.test.ts checks). */
export function layers(image, packages = []) {
  const env = Object.entries(image.env).map(([k, v]) => `ENV ${k}=${v}`);
  const base = [...env, `RUN pip install --no-cache-dir ${image.packages.map((p) => `'${p}'`).join(" ")}`];
  const extra = [...new Set(packages)].sort();
  const system = [image.system, image.datasets].filter((l) => l?.length);
  return [base, ...system, ...(extra.length ? [[`RUN pip install --no-cache-dir ${extra.map((p) => `'${p}'`).join(" ")}`]] : [])];
}

async function main(args) {
  const tokenId = process.env.MODAL_TOKEN_ID;
  const tokenSecret = process.env.MODAL_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    console.error("MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are required");
    process.exit(1);
  }
  const extra = args;
  if (extra.some((p) => !/^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([<>=!~]=?[A-Za-z0-9.*+!-]+)?$/.test(p))) {
    console.error("Not a package name:", extra.join(" "));
    process.exit(1);
  }
  const { ModalClient } = await import("modal");
  const m = new ModalClient({ tokenId, tokenSecret });
  const app = await m.apps.fromName(APP_NAME, { createIfMissing: true });
  const image = layers(spec, extra).reduce((img, layer) => img.dockerfileCommands(layer), m.images.fromRegistry(spec.base));
  const started = Date.now();
  console.log(`building ${spec.base} + ${spec.packages.length} packages${extra.length ? ` + ${extra.join(" ")}` : ""} …`);
  // The other languages' images alongside (each its own cached build; one failing doesn't stop the rest).
  const rest = extra.length
    ? []
    : otherImages().map(async ({ id, base, layers: ls }) => {
        const t = Date.now();
        try {
          const b = await ls.reduce((img, layer) => img.dockerfileCommands(layer), m.images.fromRegistry(base)).build(app);
          console.log(`built ${id} image ${b.imageId} in ${Math.round((Date.now() - t) / 1000)} s`);
        } catch (e) {
          console.warn(`modal-image: WARNING, the ${id} image didn't build; its first run will build it.`, e);
        }
      });
  const built = await image.build(app);
  console.log(`built ${built.imageId} in ${Math.round((Date.now() - started) / 1000)} s`);
  await Promise.all(rest);
}

/** Whether a postbuild in this environment should build the image: Vercel production, with tokens. */
export function shouldBuildOnVercel(env) {
  if (env.VERCEL_ENV !== "production") return { build: false, why: `not a Vercel production build (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})` };
  if (!env.MODAL_TOKEN_ID || !env.MODAL_TOKEN_SECRET) return { build: false, why: "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET are not set for production builds" };
  return { build: true, why: "" };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args[0] === "--on-vercel") {
    const { build, why } = shouldBuildOnVercel(process.env);
    if (!build) {
      console.log(`modal-image: skipped, ${why}`);
    } else {
      try {
        await main([]);
      } catch (e) {
        console.warn("modal-image: WARNING, the server image didn't build; the first server run will build it.", e);
      }
    }
  } else {
    await main(args);
  }
}
