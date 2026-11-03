#!/usr/bin/env node
// Writes every app icon from the one mark in src/lib/brand.ts:
//   src/app/icon.svg (favicon, served at /icon.svg),
//   public/icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png
// Run after changing the mark:  npm run icons
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { logoSvg } from "../src/lib/brand.ts";

const root = new URL("../", import.meta.url).pathname;
const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 72 * (size / 64) }).resize(size, size).png().toFile(root + file);

const plain = logoSvg();
const maskable = logoSvg({ padding: 0.12 }); // glyphs stay inside the 80% safe zone
const full = logoSvg({ padding: 0.08 }); // apple crops its own rounded corners; no transparent edge

await writeFile(root + "src/app/icon.svg", plain + "\n");
await Promise.all([
  png(plain, 192, "public/icons/icon-192.png"),
  png(plain, 512, "public/icons/icon-512.png"),
  png(maskable, 512, "public/icons/maskable-512.png"),
  png(full, 180, "public/icons/apple-touch-icon.png"),
]);
console.log("icons written");
