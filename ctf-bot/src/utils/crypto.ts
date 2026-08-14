import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

/**
 * Hashes a flag using scrypt with a random per-flag salt.
 * Returns a single string of the form `salt:hash` (both hex-encoded) so it
 * can be stored in a single database column.
 *
 * The plaintext flag is never persisted or logged.
 */
export function hashFlag(flag: string): string {
  const normalized = normalizeFlag(flag);
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(normalized, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

/**
 * Compares a submitted flag against a stored `salt:hash` value using a
 * timing-safe comparison to avoid leaking information via response timing.
 */
export function verifyFlag(submitted: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;

  const normalized = normalizeFlag(submitted);
  const submittedHash = scryptSync(normalized, salt, KEY_LENGTH);
  const storedHash = Buffer.from(hashHex, "hex");

  if (submittedHash.length !== storedHash.length) return false;
  return timingSafeEqual(submittedHash, storedHash);
}

// Trim whitespace and collapse case-sensitivity issues from copy/paste
// without changing the semantics of the flag itself (flags are compared
// exactly as configured by the host, just tolerant of surrounding whitespace).
function normalizeFlag(flag: string): string {
  return flag.trim();
}
