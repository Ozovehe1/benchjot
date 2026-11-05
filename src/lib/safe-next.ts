// Pure: which URLs may leave the app's control. Redirects after sign-in only go to this site;
// a note body's links open only web pages and email (the user's rule, 2026-11-05). The Android
// app's core isOpenableLink (Links.kt) answers the same, checked by the openable_links.json fixture.

/** Browsers and `new URL` drop tabs and newlines, so "/\t/evil.com" would be "//evil.com": no control characters at all. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A path on this site: starts with one "/", not "//" or "/\" (another host), no control characters. */
export function isSameSitePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") && !CONTROL.test(path);
}

/** Only same-site paths may be redirect targets; anything else falls back to home. */
export function safeNext(next: string | null): string {
  return next && isSameSitePath(next) ? next : "/";
}

/** URL schemes a link in a note may open. */
export const OPENABLE_SCHEMES = ["http", "https", "mailto"] as const;

/** An http, https or mailto link (any case, surrounding spaces ignored); everything else (javascript:, data:, file:, intent:, no scheme) is not. */
export function isOpenableLink(url: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())?.[1]?.toLowerCase();
  return scheme !== undefined && !CONTROL.test(url) && (OPENABLE_SCHEMES as readonly string[]).includes(scheme);
}

/** A note body link's href (react-markdown's urlTransform): openable links, in-app paths (note links) and #footnotes; anything else becomes inert (""). */
export function noteBodyHref(url: string): string {
  return isOpenableLink(url) || isSameSitePath(url) || (url.startsWith("#") && !CONTROL.test(url)) ? url : "";
}
