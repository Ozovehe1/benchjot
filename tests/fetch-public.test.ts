import { describe, expect, it } from "vitest";
import { FetchRefused, fetchPublic, nameFromUrl, publicAddress } from "@/lib/server/fetch-public";

describe("publicAddress: only the open internet", () => {
  it("refuses loopback, private, link-local, CGNAT, metadata and IPv6 local ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(publicAddress(ip), ip).toBe(false);
    }
  });
  it("allows public ones", () => {
    for (const ip of ["8.8.8.8", "140.82.112.3", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(publicAddress(ip), ip).toBe(true);
  });
});

describe("fetchPublic refuses before any download", () => {
  it.each([
    ["http://example.com/a.csv", /https/],
    ["https://127.0.0.1/a.csv", /private network/],
    ["https://169.254.169.254/latest/meta-data", /private network/],
    ["https://[::1]/x.csv", /private network/],
    ["https://example.com:8443/a.csv", /standard https port/],
    ["https://u:p@example.com/a.csv", /name or password/],
    ["not a url", /isn't a web address/],
  ])("%s", async (url, why) => {
    await expect(fetchPublic(url, 1000)).rejects.toThrow(why);
    await expect(fetchPublic(url, 1000)).rejects.toBeInstanceOf(FetchRefused);
  });
});

describe("nameFromUrl", () => {
  it("takes the last path part", () => {
    expect(nameFromUrl(new URL("https://x.org/data/iris.csv?raw=1"))).toBe("iris.csv");
    expect(nameFromUrl(new URL("https://x.org/a%20b.csv"))).toBe("a b.csv");
  });
});
