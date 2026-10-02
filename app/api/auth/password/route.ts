import { createSession, getCurrentUser, validLoginPassword, validNewPassword, verifyPassword, hashPassword, rateLimit } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import { z } from "zod";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  let data: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return jsonError("请求内容过长", 413);
    data = JSON.parse(raw);
  } catch { return jsonError("请求内容无效", 400); }
  const parsed = z.object({ currentPassword: z.string(), newPassword: z.string() }).safeParse(data);
  if (!parsed.success || !validLoginPassword(parsed.data.currentPassword)) return jsonError("当前密码不正确", 401);
  if (!validNewPassword(parsed.data.newPassword)) return jsonError("请输入新密码，最多 128 个字符", 400);

  try {
    const db = database();
    if (!await rateLimit(db, request, "login", user.username)) return jsonError("尝试过于频繁，请稍后再试", 429);
    const credential = await db.prepare("SELECT password_hash, password_salt, password_iterations FROM users WHERE user_id = ?")
      .bind(user.userId).first<{ password_hash: string; password_salt: string; password_iterations: number }>();
    if (!credential || !await verifyPassword(parsed.data.currentPassword, credential.password_salt, credential.password_hash, credential.password_iterations)) return jsonError("当前密码不正确", 401);
    const next = await hashPassword(parsed.data.newPassword);
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE user_id = ?")
        .bind(next.hash, next.salt, next.iterations, user.userId),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.userId),
    ]);
    const cookie = await createSession(db, user.userId, request);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch {
    console.error("password change failed");
    return jsonError("修改密码失败，请稍后重试", 503);
  }
}
