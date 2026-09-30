import { getChatGPTUser } from "@/app/chatgpt-auth";
import { byProfileId, database, jsonError, ownProfile, sameOrigin } from "@/lib/database";
import { eligible } from "@/lib/matching";
import { z } from "zod";

export const runtime = "edge";
const bodySchema = z.object({ targetId: z.string().uuid() });
const insertIfStillEligible = `
  INSERT OR IGNORE INTO likes (from_profile_id, to_profile_id, created_at)
  SELECT a.profile_id, b.profile_id, ?
  FROM profiles a JOIN profiles b ON b.profile_id = ?
  WHERE a.profile_id = ? AND a.visible = 1 AND b.visible = 1
    AND (a.seeking = 'any' OR a.seeking = b.gender)
    AND (b.seeking = 'any' OR b.seeking = a.gender)
    AND b.age BETWEEN a.min_age AND a.max_age
    AND a.age BETWEEN b.min_age AND b.max_age
    AND (a.preferred_city = '' OR lower(trim(a.preferred_city)) = lower(trim(b.city)))
    AND (b.preferred_city = '' OR lower(trim(b.preferred_city)) = lower(trim(a.city)))
    AND (a.preferred_height_min IS NULL OR b.height_cm >= a.preferred_height_min)
    AND (a.preferred_height_max IS NULL OR b.height_cm <= a.preferred_height_max)
    AND (b.preferred_height_min IS NULL OR a.height_cm >= b.preferred_height_min)
    AND (b.preferred_height_max IS NULL OR a.height_cm <= b.preferred_height_max)
    AND NOT EXISTS (
      SELECT 1 FROM blocks x WHERE
      (x.from_profile_id = a.profile_id AND x.to_profile_id = b.profile_id)
      OR (x.from_profile_id = b.profile_id AND x.to_profile_id = a.profile_id)
    )`;

async function context(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return { error: jsonError("请先登录", 401) };
  if (!sameOrigin(request)) return { error: jsonError("请求来源不正确", 403) };
  const db = database();
  const self = await ownProfile(db, user.userId);
  if (!self || self.visible !== 1) return { error: jsonError("请先发布资料", 409) };
  let body: unknown;
  try { body = await request.json(); } catch { return { error: jsonError("请求内容无效", 400) }; }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { error: jsonError("目标无效", 400) };
  const target = await byProfileId(db, parsed.data.targetId);
  if (!target || !eligible(self, target)) return { error: jsonError("当前无法向这位用户表达心动", 404) };
  const blocked = await db.prepare("SELECT 1 FROM blocks WHERE (from_profile_id = ? AND to_profile_id = ?) OR (from_profile_id = ? AND to_profile_id = ?)")
    .bind(self.profile_id, target.profile_id, target.profile_id, self.profile_id).first();
  if (blocked) return { error: jsonError("当前无法互动", 403) };
  return { db, self, target };
}

export async function POST(request: Request) {
  try {
    const value = await context(request);
    if (value.error) return value.error;
    const { db, self, target } = value;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const already = await db!.prepare("SELECT 1 FROM likes WHERE from_profile_id = ? AND to_profile_id = ?")
      .bind(self!.profile_id, target!.profile_id).first();
    if (!already) {
      const now = new Date().toISOString();
      const event = await db!.prepare("INSERT INTO like_events (event_id, from_profile_id, created_at) SELECT ?, ?, ? WHERE (SELECT count(*) FROM like_events WHERE from_profile_id = ? AND created_at >= ?) < 30")
        .bind(crypto.randomUUID(), self!.profile_id, now, self!.profile_id, since).run();
      if (!event.meta.changes) return jsonError("今天的心动次数已用完，明天再来看看", 429);
      const inserted = await db!.prepare(insertIfStillEligible).bind(now, target!.profile_id, self!.profile_id).run();
      if (!inserted.meta.changes) {
        const exists = await db!.prepare("SELECT 1 FROM likes WHERE from_profile_id = ? AND to_profile_id = ?")
          .bind(self!.profile_id, target!.profile_id).first();
        if (!exists) return jsonError("资料状态已变化，请刷新页面", 409);
      }
    }
    const reverse = await db!.prepare("SELECT 1 FROM likes WHERE from_profile_id = ? AND to_profile_id = ?")
      .bind(target!.profile_id, self!.profile_id).first();
    return Response.json({ ok: true, mutual: Boolean(reverse) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("like failed", error);
    return jsonError("操作失败，请稍后重试", 503);
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("请求内容无效", 400); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("目标无效", 400);
  try {
    const db = database();
    const self = await ownProfile(db, user.userId);
    if (!self) return jsonError("请先创建资料", 409);
    await db.prepare("DELETE FROM likes WHERE from_profile_id = ? AND to_profile_id = ?")
      .bind(self.profile_id, parsed.data.targetId).run();
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("unlike failed", error);
    return jsonError("操作失败，请稍后重试", 503);
  }
}
