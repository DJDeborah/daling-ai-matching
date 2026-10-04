import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, ownProfile, sameOrigin } from "@/lib/database";
import { matchingDocument, profileSchema } from "@/lib/profile";
import { readMatchingDepth } from "@/lib/depth";

export const runtime = "edge";

const columns = [
  "profile_id", "user_id", "name", "gender", "seeking", "age", "min_age", "max_age",
  "city", "preferred_city", "height_cm", "preferred_height_min", "preferred_height_max",
  "body_type", "preferred_body_type", "school", "mbti", "zodiac", "preferred_zodiac",
  "interests_json", "about", "partner_note", "contact_kind", "contact_value",
  "contact_share", "visible", "adult_confirmed_at", "pool_consented_at", "created_at", "updated_at",
  "matching_json",
] as const;

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  let data: unknown;
  try {
    const text = await request.text();
    if (text.length > 12000) return jsonError("资料过长", 413);
    data = JSON.parse(text);
  } catch { return jsonError("请求内容无效", 400); }
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "请检查填写内容", 400);

  try {
    const db = database();
    const current = await ownProfile(db, user.userId);
    // The original profile editor must not erase the deeper interview when saving basics.
    const input = { ...parsed.data, depth: readMatchingDepth(current?.matching_json) };
    const now = new Date().toISOString();
    const values = [
      current?.profile_id ?? crypto.randomUUID(), user.userId, input.name, input.gender, input.seeking,
      input.age, input.minAge, input.maxAge, input.city, input.preferredCity,
      input.heightCm, input.preferredHeightMin, input.preferredHeightMax, input.bodyType,
      input.preferredBodyType, input.school, input.mbti, input.zodiac, input.preferredZodiac,
      JSON.stringify(input.interests), input.about, input.partnerNote, input.contactKind,
      input.contactValue, Number(input.contactShare), Number(input.visible),
      current?.adult_confirmed_at ?? now, input.poolConsent ? now : null,
      current?.created_at ?? now, now,
      JSON.stringify(matchingDocument(input)),
    ];
    const mutable = columns.slice(2).filter(c => c !== "adult_confirmed_at" && c !== "created_at");
    // Preserve the latest deep interview atomically, including when a chat save races this basic edit.
    const sql = `INSERT INTO profiles (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(user_id) DO UPDATE SET ${mutable.map(c => c === "matching_json" ? `matching_json = json_set(excluded.matching_json, '$.depth', json(CASE WHEN json_valid(profiles.matching_json) THEN COALESCE(json_extract(profiles.matching_json, '$.depth'), '{"version":1,"topics":{}}') ELSE '{"version":1,"topics":{}}' END))` : `${c} = excluded.${c}`).join(", ")}`;
    const write = db.prepare(sql).bind(...values);
    const clearReport = db.prepare("DELETE FROM match_reports WHERE user_id = ?").bind(user.userId);
    if (!input.visible && current) {
      await db.batch([
        write,
        db.prepare("DELETE FROM likes WHERE from_profile_id = ? OR to_profile_id = ?").bind(current.profile_id, current.profile_id),
        clearReport,
      ]);
    } else {
      await db.batch([write, clearReport]);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("profile save failed", error);
    return jsonError("暂时无法保存，请稍后重试", 503);
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  try {
    const db = database();
    const current = await ownProfile(db, user.userId);
    const cancelWechat = db.prepare("UPDATE wechat_events SET state = 'done', reply = '资料已删除，请发送进度重新开始。', started_revision = NULL, started_turn = NULL WHERE user_id = ?").bind(user.userId);
    if (current) {
      await db.batch([
        cancelWechat,
        db.prepare("DELETE FROM likes WHERE from_profile_id = ? OR to_profile_id = ?").bind(current.profile_id, current.profile_id),
        db.prepare("DELETE FROM blocks WHERE from_profile_id = ? OR to_profile_id = ?").bind(current.profile_id, current.profile_id),
        db.prepare("DELETE FROM like_events WHERE from_profile_id = ?").bind(current.profile_id),
        db.prepare("DELETE FROM profiles WHERE profile_id = ?").bind(current.profile_id),
        db.prepare("DELETE FROM conversations WHERE user_id = ?").bind(user.userId),
        db.prepare("DELETE FROM match_reports WHERE user_id = ?").bind(user.userId),
        db.prepare("DELETE FROM draft_match_reports WHERE user_id = ?").bind(user.userId),
      ]);
    } else {
      await db.batch([
        cancelWechat,
        db.prepare("DELETE FROM conversations WHERE user_id = ?").bind(user.userId),
        db.prepare("DELETE FROM match_reports WHERE user_id = ?").bind(user.userId),
        db.prepare("DELETE FROM draft_match_reports WHERE user_id = ?").bind(user.userId),
      ]);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("profile delete failed", error);
    return jsonError("暂时无法删除，请稍后重试", 503);
  }
}
