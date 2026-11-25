/** Invite codes, node tokens and durations for the hub door. */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Readable one-use code: 3 groups of 4, no look-alike characters. */
export function newInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

export function newNodeToken(): string {
  return `arra_node_${randomBytes(24).toString('base64url')}`;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret.trim()).digest('hex');
}

/** Codes are typed by people: accept lower case and stray spaces. */
export function hashInviteCode(code: string): string {
  return hashSecret(code.replace(/\s+/g, '').toUpperCase());
}

export function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "15m" | "1h" | "7d" | "forever" → ms, or null for forever. Throws on anything else. */
export function parseDuration(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (v === 'forever') return null;
  const match = v.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`invalid duration "${value}": use 15m, 1h, 7d or forever`);
  const ms = Number(match[1]) * UNIT_MS[match[2]];
  if (ms <= 0) throw new Error(`invalid duration "${value}": must be more than 0`);
  return ms;
}

export function expiryFrom(grant: string, now = new Date()): string | null {
  const ms = parseDuration(grant);
  return ms === null ? null : new Date(now.getTime() + ms).toISOString();
}

/** "14m left", "expired", "forever" — for tables. */
export function timeLeft(expiresAt: string | null, now = new Date()): string {
  if (!expiresAt) return 'forever';
  const ms = Date.parse(expiresAt) - now.getTime();
  if (ms <= 0) return 'expired';
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)}m left`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h left`;
  return `${Math.round(ms / 86_400_000)}d left`;
}
