// Username rules. The database enforces the same pattern (private.valid_username);
// keep the two in step.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const USERNAME_HINT = "3 to 20 letters, numbers or underscores.";

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function isValidUsername(name: string): boolean {
  return USERNAME_PATTERN.test(name);
}

/** A starting suggestion from an email's local part, e.g. "Ada.Lovelace+x@..." → "ada_lovelace". */
export function suggestUsername(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0]?.split("+")[0] ?? "";
  const s = local.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  return s.length >= 3 ? s : "";
}

/** True when the sign-in field holds an email rather than a username. */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@") && !identifier.startsWith("@");
}
