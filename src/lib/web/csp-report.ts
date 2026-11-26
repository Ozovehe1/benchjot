// Pure: reads a browser's CSP violation report, either format, into short records to log.
//   report-uri (application/csp-report):  {"csp-report": {"violated-directive", "blocked-uri", "document-uri", ...}}
//   report-to (application/reports+json): [{"type": "csp-violation", "body": {"effectiveDirective", "blockedURL", "documentURL", ...}}]

interface CspViolation {
  directive: string;
  /** The origin (scheme://host) or keyword ("inline", "eval", "data", "blob") that was blocked. */
  blocked: string;
  /** The page's path, without its query string. */
  page: string;
  /** "file:line" of the violation, without query strings, when the browser gives it. */
  source?: string;
}

const MAX_REPORTS = 20;

/** Origin for URLs, the keyword as is otherwise; never a path or query (they can hold user data). */
function origin(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "wss:" ? u.origin : u.protocol.replace(/:$/, "");
  } catch {
    return s.slice(0, 40);
  }
}

function path(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  try {
    // Note ids are uuids: kept as a shape, not the id.
    return new URL(s).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  } catch {
    return "";
  }
}

function source(file: unknown, line: unknown): string | undefined {
  const o = origin(file);
  if (!o) return undefined;
  const p = path(file);
  return `${o}${p}${typeof line === "number" ? `:${line}` : ""}`;
}

function one(b: Record<string, unknown>): CspViolation | null {
  const directive = String(b["effectiveDirective"] ?? b["effective-directive"] ?? b["violated-directive"] ?? "").split(" ")[0] ?? "";
  if (!directive) return null;
  const v: CspViolation = { directive: directive.slice(0, 40), blocked: origin(b["blockedURL"] ?? b["blocked-uri"]), page: path(b["documentURL"] ?? b["document-uri"]) };
  const s = source(b["sourceFile"] ?? b["source-file"], b["lineNumber"] ?? b["line-number"]);
  if (s) v.source = s;
  return v;
}

/** The violations in a report body (either format); [] for anything else. */
export function cspViolations(text: string): CspViolation[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const bodies: unknown[] = Array.isArray(data)
    ? data.filter((r) => r && typeof r === "object" && (r as { type?: unknown }).type === "csp-violation").map((r) => (r as { body?: unknown }).body)
    : [data && typeof data === "object" ? (data as Record<string, unknown>)["csp-report"] : null];
  return bodies
    .slice(0, MAX_REPORTS)
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map(one)
    .filter((v): v is CspViolation => v !== null);
}
