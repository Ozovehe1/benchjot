// The Benchjot mark: a lowercase monospace "bj" on an amber tile, where the
// dot of the j is a block cursor. One definition, used by the <Logo>
// component and by scripts/make-icons.mjs (favicon, PWA and apple icons).
// Pure data and string building only, so the Node icon script can import it.

export const BRAND = {
  /** The one accent colour. Dark ink on it reads at > 7:1 in both themes. */
  accent: "#e8952f",
  /** Ink on the accent (glyphs, filled-button text). */
  ink: "#1a1a19",
} as const;

/** 64-unit grid. Stroke paths for "b" and the j's stem; the cursor is a filled rect. */
export const MARK = {
  viewBox: 64,
  radius: 14,
  stroke: 6,
  paths: [
    "M15 12V46H28a6 6 0 0 0 6-6V32a6 6 0 0 0-6-6H15", // b
    "M47 27V47a7 7 0 0 1-7 7H37", // j stem and hook
  ],
  cursor: { x: 43, y: 11, width: 8, height: 10 }, // j dot as a block cursor
} as const;

/**
 * Standalone SVG of the mark. `padding` (0..0.5 of the size) shrinks the tile
 * inside a full-bleed background, for maskable icons that crop to a circle.
 */
export function logoSvg({ padding = 0 }: { padding?: number } = {}): string {
  if (padding < 0 || padding >= 0.5) throw new RangeError("padding must be in [0, 0.5)");
  const v = MARK.viewBox;
  const inner = v * (1 - 2 * padding);
  const offset = v * padding;
  const scale = inner / v;
  const background = padding > 0 ? `<rect width="${v}" height="${v}" fill="${BRAND.accent}"/>` : "";
  const tile = padding > 0 ? "" : `<rect width="${v}" height="${v}" rx="${MARK.radius}" fill="${BRAND.accent}"/>`;
  const c = MARK.cursor;
  const glyphs =
    `<g transform="translate(${offset} ${offset}) scale(${scale})">` +
    MARK.paths.map((d) => `<path d="${d}" fill="none" stroke="${BRAND.ink}" stroke-width="${MARK.stroke}" stroke-linecap="square" stroke-linejoin="miter"/>`).join("") +
    `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" fill="${BRAND.ink}"/>` +
    `</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}">${background}${tile}${glyphs}</svg>`;
}
