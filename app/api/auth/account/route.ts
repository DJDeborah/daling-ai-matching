import { clearSessionCookie, getCurrentUser, rateLimit, validLoginPassword, verifyPassword } from "@/lib/auth";
import { database, jsonError, ownProfile, sameOrigin } from "@/lib/database";
import { z } from "zod";

export const runtime = "edge";

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  let data: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return jsonError("请求内容过长", 413);
    data = JSON.parse(raw);
  } catch { return jsonError("请求内容无效", 400); }
  const parsed = z.object({ password: z.string() }).safeParse(data);
  if (!parsed.success || !validLoginPassword(parsed.data.password)) return jsonError("密码不正确", 401);

  try {
    const db = database();
    if (!await rateLimit(db, request, "login", user.username)) return jsonError("尝试过于频繁，请稍后再试", 429);
    const credential = await db.prepare("SELECT password_hash, password_salt, password_iterations FROM users WHERE user_id = ?")
      .bind(user.userId).first<{ password_hash: string; password_salt: string; password_iterations: number }>();
    if (!credential || !await verifyPassword(parsed.data.password, credential.password_salt, credential.password_hash, credential.password_iterations)) return jsonError("密码不正确", 401);
    const profile = await ownProfile(db, user.userId);
    const statements = profile ? [
      db.prepare("DELETE FROM likes WHERE from_profile_id = ? OR to_profile_id = ?").bind(profile.profile_id, profile.profile_id),
      db.prepare("DELETE FROM blocks WHERE from_profile_id = ? OR to_profile_id = ?").bind(profile.profile_id, profile.profile_id),
      db.prepare("DELETE FROM like_events WHERE from_profile_id = ?").bind(profile.profile_id),
      db.prepare("DELETE FROM profiles WHERE profile_id = ?").bind(profile.profile_id),
    ] : [];
    await db.batch([
      ...statements,
      db.prepare("DELETE FROM ai_usage WHERE user_id = ?").bind(user.userId),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.userId),
      db.prepare("DELETE FROM users WHERE user_id = ?").bind(user.userId),
    ]);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request), "Cache-Control": "no-store" } });
  } catch {
    console.error("account delete failed");
    return jsonError("暂时无法删除账号，请稍后重试", 503);
  }
}
