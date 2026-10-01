import { env } from "cloudflare:workers";
import type { ProfileRow } from "./profile";

export function database(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function ownProfile(db: D1Database, userId: string): Promise<ProfileRow | null> {
  return (await db.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(userId).first<ProfileRow>()) ?? null;
}

export async function byProfileId(db: D1Database, profileId: string): Promise<ProfileRow | null> {
  return (await db.prepare("SELECT * FROM profiles WHERE profile_id = ?").bind(profileId).first<ProfileRow>()) ?? null;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin) return origin === expected;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;
  if (fetchSite === "same-origin") return true;
  const referer = request.headers.get("referer");
  if (referer) {
    try { return new URL(referer).origin === expected; } catch { return false; }
  }
  return false;
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
