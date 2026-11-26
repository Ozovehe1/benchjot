// Server-side only: downloads a file from a public https address for the Data library (a user's
// "Add by address" or the Assistant's save_data). Guards against reaching the server's own network:
// https only, standard port, and every address the host resolves to (and every redirect's) must be
// public; a size cap read as it streams, and a time limit.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchRefused extends Error {}

const MAX_REDIRECTS = 4;

/** True for addresses on the open internet; false for loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return publicAddress(mapped[1]!);
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff")) return false;
    return true;
  }
  return false;
}

async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused("That isn't a web address.");
  }
  if (url.protocol !== "https:") throw new FetchRefused("Only https:// addresses can be added.");
  if (url.port && url.port !== "443") throw new FetchRefused("Only addresses on the standard https port can be added.");
  if (url.username || url.password) throw new FetchRefused("Addresses with a name or password in them can't be added.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length) throw new FetchRefused(`Couldn't find ${host}.`);
  if (!ips.every(publicAddress)) throw new FetchRefused("That address points inside a private network, so it can't be added.");
  return url;
}

/** The file at a public https address, at most `maxBytes`, within `timeoutMs`. Throws FetchRefused with text for the user. */
export async function fetchPublic(raw: string, maxBytes: number, timeoutMs = 60_000): Promise<{ bytes: Uint8Array; type: string; finalUrl: URL }> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await checkUrl(raw);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal, headers: { "user-agent": "Benchjot-Data/1.0" } });
    } catch {
      throw new FetchRefused(signal.aborted ? "The download took too long." : `Couldn't reach ${url.hostname}.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new FetchRefused("That address redirects too many times.");
      url = await checkUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok || !res.body) throw new FetchRefused(`${url.hostname} answered ${res.status}${res.status === 401 || res.status === 403 ? " (it needs a sign-in)" : res.status === 404 ? " (no file there)" : ""}.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new FetchRefused(`That file is ${Math.ceil(declared / 1048576)} MB; the most one dataset can be is ${Math.round(maxBytes / 1048576)} MB.`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new FetchRefused(`That file is over ${Math.round(maxBytes / 1048576)} MB, the most one dataset can be.`);
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof FetchRefused) throw e;
      throw new FetchRefused(signal.aborted ? "The download took too long." : "The download broke off. Try again.");
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { bytes, type: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim(), finalUrl: url };
  }
}

/** A file name from an address's last path part ("…/data/iris.csv?x=1" → "iris.csv"), or "". */
export function nameFromUrl(url: URL): string {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return last;
}
