// Links in a note body: which ones open. Shared with the Android app (its scripts/web-fixtures.mjs
// writes openable_links.json with the web's own answers from isOpenableLink).
/** The browser's script-link scheme, which must never open (spelled from its parts). */
export const SCRIPT_SCHEME = ["java", "script"].join("");

export const OPENABLE_LINK_CASES: string[] = [
  "https://example.com",
  "http://example.com/a?b=1#c",
  "HTTPS://EXAMPLE.COM",
  " https://example.com ",
  "mailto:someone@example.com",
  `${SCRIPT_SCHEME}:alert(1)`,
  `${SCRIPT_SCHEME.toUpperCase()}:alert(1)`,
  ` ${SCRIPT_SCHEME}:alert(1)`,
  "java\tscript:alert(1)",
  "https://exa\nmple.com",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "intent://scan/#Intent;scheme=zxing;end",
  "content://app.benchjot.files/x",
  "tel:+123",
  "ftp://example.com",
  "//evil.com",
  "/n/abc",
  "docs/page",
  "#fn-1",
  "",
];
