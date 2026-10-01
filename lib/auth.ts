import { headers } from "next/headers";
import { database } from "./database";

const COOKIE = "daling_session";
const SESSION_DAYS = 14;
export const PASSWORD_ITERATIONS = 600_000;

export type SiteUser = { userId: string; username: string };

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch { return null; }
}

export function normalizeUsername(value: string): string | null {
  const name = value.normalize("NFKC").trim().toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(name) ? name : null;
}

export function validNewPassword(value: string): boolean {
  const length = new TextEncoder().encode(value).length;
  return value.length >= 15 && value.length <= 128 && length <= 256;
}

export function validLoginPassword(value: string): boolean {
  return value.length > 0 && value.length <= 128 && new TextEncoder().encode(value).length <= 256;
}

export function randomToken(byteCount = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const ownedSalt = new Uint8Array(salt.length);
  ownedSalt.set(salt);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: ownedSalt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(24));
  const hash = await derive(password, salt, PASSWORD_ITERATIONS);
  return { hash: bytesToBase64Url(hash), salt: bytesToBase64Url(salt), iterations: PASSWORD_ITERATIONS };
}

export async function verifyPassword(password: string, saltText: string, hashText: string, iterations: number): Promise<boolean> {
  const salt = base64UrlToBytes(saltText);
  const expected = base64UrlToBytes(hashText);
  if (!salt || salt.length !== 24 || !expected || expected.length !== 32 || iterations < 100_000 || iterations > 1_000_000) return false;
  const actual = await derive(password, salt, iterations);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}

// Run an equivalent KDF for a missing username, so failure time does not disclose account existence.
export async function verifyMissingUser(password: string): Promise<void> {
  await derive(password, new Uint8Array(24), PASSWORD_ITERATIONS);
}

function cookieFromHeader(value: string | null): string | null {
  const entry = value?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  if (!entry) return null;
  const token = entry.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function getCurrentUser(request?: Request): Promise<SiteUser | null> {
  const cookieHeader = request ? request.headers.get("cookie") : (await headers()).get("cookie");
  const token = cookieFromHeader(cookieHeader);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await database().prepare("SELECT u.user_id, u.username FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(tokenHash, new Date().toISOString()).first<{ user_id: string; username: string }>();
  return row ? { userId: row.user_id, username: row.username } : null;
}

export async function createSession(db: D1Database, userId: string, request: Request): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const expiry = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now.toISOString()).run();
  await db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now.toISOString(), expiry.toISOString()).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export async function revokeSession(db: D1Database, request: Request): Promise<void> {
  const token = cookieFromHeader(request.headers.get("cookie"));
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export async function rateLimit(db: D1Database, request: Request, kind: string, username?: string): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip");
  const now = new Date();
  await db.prepare("DELETE FROM auth_rate_limits WHERE reset_at <= ?").bind(now.toISOString()).run();
  async function consume(namespace: string, duration: number, maxHits: number) {
    const bucket = await sha256(namespace);
    const resetAt = new Date(now.getTime() + duration).toISOString();
    const row = await db.prepare(`INSERT INTO auth_rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET
        hits = CASE WHEN reset_at <= ? THEN 1 ELSE hits + 1 END,
        reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
      RETURNING hits`)
      .bind(bucket, resetAt, now.toISOString(), now.toISOString()).first<{ hits: number }>();
    return (row?.hits ?? maxHits + 1) <= maxHits;
  }
  if (kind === "register") return ip ? consume(`register:ip:${ip}`, 3600_000, 6) : true;
  const globalIp = ip ? await consume(`login:ip:${ip}`, 900_000, 40) : true;
  const globalUser = await consume(`login:user:${username ?? ""}`, 900_000, 40);
  const pair = ip ? await consume(`login:pair:${ip}:${username ?? ""}`, 900_000, 8) : true;
  return globalIp && globalUser && pair;
}
