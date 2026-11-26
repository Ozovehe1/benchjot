// CSP violation reports (src/lib/web/csp-report.ts, /api/csp-report): both browser formats, logged
// without paths of blocked URLs, query strings or note ids; anything else is ignored.
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import { POST } from "@/app/api/csp-report/route";
import { cspViolations } from "@/lib/web/csp-report";

afterEach(() => vi.restoreAllMocks());

const NOTE = "https://benchjot.vercel.app/n/0b9e7c1a-1111-4222-8333-444455556666?q=secret";

describe("cspViolations", () => {
  it("reads report-uri's csp-report body", () => {
    const body = { "csp-report": { "violated-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js?token=1", "document-uri": NOTE, "source-file": "https://benchjot.vercel.app/_next/static/a.js?v=2", "line-number": 9 } };
    expect(cspViolations(JSON.stringify(body))).toEqual([{ directive: "script-src-elem", blocked: "https://evil.example", page: "/n/:id", source: "https://benchjot.vercel.app/_next/static/a.js:9" }]);
  });
  it("reads report-to's list, keeping only csp-violation notes", () => {
    const list = [
      { type: "csp-violation", body: { effectiveDirective: "connect-src", blockedURL: "wss://x.example/socket", documentURL: "https://benchjot.vercel.app/map" } },
      { type: "deprecation", body: { id: "x" } },
      { type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "eval", documentURL: NOTE } },
    ];
    expect(cspViolations(JSON.stringify(list))).toEqual([
      { directive: "connect-src", blocked: "wss://x.example", page: "/map" },
      { directive: "script-src", blocked: "eval", page: "/n/:id" },
    ]);
  });
  it("ignores bodies that aren't reports", () => {
    for (const t of ["", "not json", "null", "{}", '{"csp-report": 5}', "[1, 2]", '[{"type":"csp-violation","body":{}}]']) expect(cspViolations(t)).toEqual([]);
  });
});

describe("POST /api/csp-report", () => {
  it("logs one line per violation and answers 204; too-large bodies are dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify({ "csp-report": { "violated-directive": "img-src", "blocked-uri": "data", "document-uri": "https://benchjot.vercel.app/" } });
    const r = await POST(new Request("http://x/api/csp-report", { method: "POST", body }));
    expect(r.status).toBe(204);
    expect(warn).toHaveBeenCalledWith("csp-violation", JSON.stringify({ directive: "img-src", blocked: "data", page: "/" }));
    warn.mockClear();
    expect((await POST(new Request("http://x/api/csp-report", { method: "POST", body: body + " ".repeat(70_000) }))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("next.config headers", () => {
  it("the Report-Only policy reports to /api/csp-report, both ways", async () => {
    const [all] = await nextConfig.headers!();
    const h = Object.fromEntries(all!.headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy-Report-Only"]).toContain("report-uri /api/csp-report");
    expect(h["Content-Security-Policy-Report-Only"]).toContain("report-to csp");
    expect(h["Reporting-Endpoints"]).toBe('csp="/api/csp-report"');
  });
});
