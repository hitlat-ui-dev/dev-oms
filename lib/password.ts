import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Node-only (scryptSync), so this stays out of middleware.ts (Edge runtime)
// and lib/auth.ts - password hashing only ever happens inside API routes.
const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function isHashedPassword(value: string | undefined | null): boolean {
  return typeof value === "string" && value.startsWith("scrypt:");
}

export function verifyPassword(plain: string, stored: string | undefined | null): boolean {
  if (!isHashedPassword(stored)) return false;
  const [, salt, hash] = (stored as string).split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const candidate = scryptSync(plain, salt, KEY_LENGTH);
  if (candidate.length !== hashBuffer.length) return false;
  return timingSafeEqual(candidate, hashBuffer);
}
