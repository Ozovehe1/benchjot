import { describe, expect, it } from "vitest";
import { crc32, zip } from "@/lib/zip";

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it("writes local headers, data, a central directory and the end record", () => {
    const a = new TextEncoder().encode("hello");
    const z = zip([{ name: "a.txt", data: a }, { name: "dir/b.bin", data: new Uint8Array([1, 2, 3]) }], new Date(2026, 10, 4, 12, 0, 0));
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(z.subarray(30, 35))).toBe("a.txt");
    expect(new TextDecoder().decode(z.subarray(35, 40))).toBe("hello");
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cd = v.getUint32(end + 16, true);
    expect(v.getUint32(cd, true)).toBe(0x02014b50);
    expect(v.getUint32(cd + 16, true)).toBe(crc32(a));
  });
});
