// POST /api/csp-report — where browsers send Content-Security-Policy violations (next.config.ts:
// report-uri for older browsers, report-to via Reporting-Endpoints for newer ones). Each one is
// logged as a single line (directive, blocked origin, page path; no query strings, no user data)
// so the Report-Only policy can be promoted to enforcing once the logs are clean.
import { cspViolations } from "@/lib/web/csp-report";

export const runtime = "nodejs";

const MAX_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length <= MAX_BYTES) {
    for (const v of cspViolations(text)) console.warn("csp-violation", JSON.stringify(v));
  }
  return new Response(null, { status: 204 });
}
