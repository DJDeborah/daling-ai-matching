import { createSession, normalizeUsername, rateLimit, validLoginPassword, verifyMissingUser, verifyPassword } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import { z } from "zod";

export const runtime = "edge";
const genericFailure = () => jsonError("用户名或密码不正确", 401);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  let data: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return jsonError("请求内容过长", 413);
    data = JSON.parse(raw);
  } catch { return jsonError("请求内容无效", 400); }
  const parsed = z.object({ username: z.string(), password: z.string() }).safeParse(data);
  if (!parsed.success || !validLoginPassword(parsed.data.password)) return genericFailure();
  const username = normalizeUsername(parsed.data.username);
  if (!username) return genericFailure();

  try {
    const db = database();
    if (!await rateLimit(db, request, "login", username)) return jsonError("尝试过于频繁，请 15 分钟后重试", 429);
    const user = await db.prepare("SELECT user_id, password_hash, password_salt, password_iterations FROM users WHERE username = ?")
      .bind(username).first<{ user_id: string; password_hash: string; password_salt: string; password_iterations: number }>();
    if (!user) { await verifyMissingUser(parsed.data.password); return genericFailure(); }
    if (!await verifyPassword(parsed.data.password, user.password_salt, user.password_hash, user.password_iterations)) return genericFailure();
    const cookie = await createSession(db, user.user_id, request);
    return Response.json({ ok: true, username }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch {
    console.error("login failed");
    return jsonError("登录暂时不可用，请稍后再试", 503);
  }
}
