// Pure: reads an `Authorization: Bearer <token>` header. Native clients (the
// Android app) send the user's Supabase access token this way instead of cookies.

/** The token from an Authorization header, or null when it isn't a well-formed Bearer header. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(header ?? "");
  return m?.[1] ?? null;
}
