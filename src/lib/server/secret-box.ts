// Server-side only: keys users connect (a Hugging Face token) are
// encrypted before they reach the database and decrypted only here, at the moment they're used.
// AES-256-GCM with a random nonce per value; the key comes from KEY_ENCRYPTION_SECRET, which only
// the app's server has. A copy of the database alone reveals none of them. Without the secret
// nothing is sealed (connecting is refused), so a key is never stored in the clear by accident.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  return secret && secret.length >= 32 ? createHash("sha256").update(secret).digest() : null;
}

/** Whether keys can be stored at all (the server has its secret). */
export const canSeal = () => key() !== null;

/** Encrypts a secret for storage: "enc:v1:<nonce>.<ciphertext+tag>" (base64url). Throws without the server's secret. */
export function seal(plain: string): string {
  const k = key();
  if (!k) throw new Error("KEY_ENCRYPTION_SECRET is not set");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, nonce);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}${nonce.toString("base64url")}.${body.toString("base64url")}`;
}

/**
 * A stored secret back in the clear; null when it can't be read (wrong secret, damaged value).
 * A value saved before encryption (no prefix) is returned as it is.
 */
export function open(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  const [n, b] = stored.slice(PREFIX.length).split(".");
  if (!k || !n || !b) return null;
  try {
    const body = Buffer.from(b, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(n, "base64url"));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const isSealed = (stored: string | null | undefined) => Boolean(stored?.startsWith(PREFIX));

