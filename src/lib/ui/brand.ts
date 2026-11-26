// The Benchjot mark: a top-bound jotter pad (three binding rings) with a
// prompt chevron and block cursor on the page. Monochrome: ash on charcoal.
// One definition, used by the <LogoMark> component and by
// scripts/make-icons.mjs (favicon, PWA and apple icons).
// Pure data and string building only, so the Node icon script can import it.

/** The two brand colours. They are also the dark theme's --bg and --fg (set on <html> in layout.tsx). */
export const BRAND = {
  charcoal: "#161616",
  ash: "#e8e6e3",
} as const;

/** 64-unit grid. Every shape is stroked; the cursor is a filled rect. */
export const MARK = {
  viewBox: 64,
  radius: 14, // icon background corner
  stroke: 4,
  paths: [
    "M13 15H51V55H13Z", // pad
    "M22 9V19M32 9V19M42 9V19", // binding rings
    "M21 30L27 36L21 42", // prompt chevron
  ],
  cursor: { x: 31, y: 39, width: 10, height: 4 }, // underscore cursor after the prompt
} as const;

/**
 * Standalone SVG of the mark: ash glyphs on a charcoal square. `padding` (0..0.5
 * of the size) makes the background full-bleed and shrinks the glyphs inside it,
 * for maskable icons that crop to a circle; at 0 the background has rounded corners.
 */
export function logoSvg({ padding = 0 }: { padding?: number } = {}): string {
  if (padding < 0 || padding >= 0.5) throw new RangeError("padding must be in [0, 0.5)");
  const v = MARK.viewBox;
  const offset = v * padding;
  const scale = 1 - 2 * padding;
  const rx = padding > 0 ? "" : ` rx="${MARK.radius}"`;
  const c = MARK.cursor;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}">` +
    `<rect width="${v}" height="${v}"${rx} fill="${BRAND.charcoal}"/>` +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">` +
    MARK.paths.map((d) => `<path d="${d}" fill="none" stroke="${BRAND.ash}" stroke-width="${MARK.stroke}" stroke-linecap="square" stroke-linejoin="miter"/>`).join("") +
    `<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" fill="${BRAND.ash}"/>` +
    `</g></svg>`
  );
}
