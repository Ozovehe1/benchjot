#!/usr/bin/env node
// Copies large runtime assets from node_modules into public/vendor (gitignored),
// so they are served as plain static files and cached by the service worker.
import { copyFile, mkdir } from "node:fs/promises";

const FILES = [["node_modules/@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm", "public/vendor/ruff_wasm_bg.wasm"]];

await mkdir("public/vendor", { recursive: true });
for (const [from, to] of FILES) await copyFile(from, to);
console.log(`vendor: copied ${FILES.length} file(s)`);
