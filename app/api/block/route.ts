import { getCurrentUser } from "@/lib/auth";
import { byProfileId, database, jsonError, ownProfile, sameOrigin } from "@/lib/database";
import { z } from "zod";

export const runtime = "edge";

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("请求内容无效", 400); }
  const parsed = z.object({ targetId: z.string().uuid() }).safeParse(body);
  if (!parsed.success) return jsonError("目标无效", 400);
  try {
    const db = database();
    const self = await ownProfile(db, user.userId);
    const target = await byProfileId(db, parsed.data.targetId);
    if (!self || !target || self.profile_id === target.profile_id) return jsonError("目标无效", 404);
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO blocks (from_profile_id, to_profile_id, created_at) VALUES (?, ?, ?)").bind(self.profile_id, target.profile_id, new Date().toISOString()),
      db.prepare("DELETE FROM likes WHERE (from_profile_id = ? AND to_profile_id = ?) OR (from_profile_id = ? AND to_profile_id = ?)")
        .bind(self.profile_id, target.profile_id, target.profile_id, self.profile_id),
    ]);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("block failed", error);
    return jsonError("操作失败，请稍后重试", 503);
  }
}
