// A minimal zip writer (stored, no compression): enough to download a run's
// outputs as one file without a dependency. Images and PDFs are already
// compressed, so storing loses little. Pure.

let table: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of data) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds a zip archive of the entries (names are UTF-8; directories implied by "/"). */
export function zip(entries: readonly { name: string; data: Uint8Array }[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const head = (sig: number, central: boolean) => {
      const b = new Uint8Array((central ? 46 : 30) + name.length);
      const v = new DataView(b.buffer);
      let p = 0;
      const u32 = (x: number) => (v.setUint32(p, x, true), (p += 4));
      const u16 = (x: number) => (v.setUint16(p, x, true), (p += 2));
      u32(sig);
      if (central) u16(20); // version made by
      u16(20); // version needed
      u16(0x0800); // UTF-8 names
      u16(0); // stored
      u16(time);
      u16(day);
      u32(crc);
      u32(size);
      u32(size);
      u16(name.length);
      u16(0); // extra
      if (central) {
        u16(0); // comment
        u16(0); // disk
        u16(0); // internal attrs
        u32(0); // external attrs
        u32(offset);
      }
      b.set(name, p);
      return b;
    };
    const local = head(0x04034b50, false);
    locals.push(local, e.data);
    centrals.push(head(0x02014b50, true));
    offset += local.length + size;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, centralSize, true);
  v.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
