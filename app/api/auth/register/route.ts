import { createSession, hashPassword, normalizeUsername, rateLimit, validNewPassword } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import { z } from "zod";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  let data: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return jsonError("请求内容过长", 413);
    data = JSON.parse(raw);
  } catch { return jsonError("请求内容无效", 400); }
  const parsed = z.object({ username: z.string(), password: z.string(), adultConfirmed: z.boolean().optional() }).safeParse(data);
  if (!parsed.success) return jsonError("用户名需为 3–24 位英文字母、数字或下划线", 400);
  if (parsed.data.adultConfirmed !== true) return jsonError("本站仅供已满 18 岁的用户注册", 400);
  const username = normalizeUsername(parsed.data.username);
  if (!username) return jsonError("用户名需为 3–24 位英文字母、数字或下划线", 400);
  if (!validNewPassword(parsed.data.password)) return jsonError("密码需至少 15 位、最多 128 位", 400);

  try {
    const db = database();
    if (!await rateLimit(db, request, "register")) return jsonError("尝试过于频繁，请稍后再试", 429);
    const existing = await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
    if (existing) return jsonError("用户名已被使用", 409);
    const password = await hashPassword(parsed.data.password);
    const userId = crypto.randomUUID();
    const inserted = await db.prepare("INSERT OR IGNORE INTO users (user_id, username, password_hash, password_salt, password_iterations, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(userId, username, password.hash, password.salt, password.iterations, new Date().toISOString()).run();
    if (!inserted.meta.changes) return jsonError("用户名已被使用", 409);
    const cookie = await createSession(db, userId, request);
    return Response.json({ ok: true, username }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch {
    console.error("registration failed");
    return jsonError("注册暂时不可用，请稍后再试", 503);
  }
}
