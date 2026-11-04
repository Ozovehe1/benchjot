// A one-page PDF holding one lossless RGB image (Flate-compressed pixels), for
// chart downloads. Pure: callers pass pixels already deflated (zlib), so this runs
// in tests without a browser. The page is sized in points from the image's CSS size.

export interface PdfImage {
  /** zlib-deflated RGB bytes, `width * height * 3` before compression. */
  deflated: Uint8Array;
  width: number;
  height: number;
  /** Page size in points (1/72 in). */
  pageWidth: number;
  pageHeight: number;
}

export function imagePdf({ deflated, width, height, pageWidth, pageHeight }: PdfImage): Uint8Array {
  if (!(width > 0 && height > 0 && pageWidth > 0 && pageHeight > 0)) throw new Error("PDF image needs a positive size");
  const enc = new TextEncoder();
  const pw = +pageWidth.toFixed(2);
  const ph = +pageHeight.toFixed(2);
  const content = enc.encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
  const objects: (string | [string, Uint8Array])[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${deflated.length} >>`, deflated],
    [`<< /Length ${content.length} >>`, content],
  ];
  const parts: Uint8Array[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? enc.encode(b) : b;
    parts.push(bytes);
    size += bytes.length;
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(size);
    if (typeof o === "string") push(`${i + 1} 0 obj\n${o}\nendobj\n`);
    else {
      push(`${i + 1} 0 obj\n${o[0]}\nstream\n`);
      push(o[1]);
      push("\nendstream\nendobj\n");
    }
  });
  const xref = size;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** RGBA pixels -> RGB over white (PDF images have no alpha here), zlib-deflated. */
export async function deflateRgb(rgba: Uint8ClampedArray | Uint8Array): Promise<Uint8Array> {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3]! / 255;
    rgb[j] = Math.round(rgba[i]! * a + 255 * (1 - a));
    rgb[j + 1] = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    rgb[j + 2] = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
  }
  const stream = new Blob([rgb as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
