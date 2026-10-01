import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, ownProfile, sameOrigin } from "@/lib/database";
import { profileSchema } from "@/lib/profile";

export const runtime = "edge";

const columns = [
  "profile_id", "user_id", "name", "gender", "seeking", "age", "min_age", "max_age",
  "city", "preferred_city", "height_cm", "preferred_height_min", "preferred_height_max",
  "body_type", "preferred_body_type", "school", "mbti", "zodiac", "preferred_zodiac",
  "interests_json", "about", "partner_note", "contact_kind", "contact_value",
  "contact_share", "visible", "adult_confirmed_at", "pool_consented_at", "created_at", "updated_at",
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
    const input = parsed.data;
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
    ];
    const mutable = columns.slice(2).filter(c => c !== "adult_confirmed_at" && c !== "created_at");
    const sql = `INSERT INTO profiles (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(user_id) DO UPDATE SET ${mutable.map(c => `${c} = excluded.${c}`).join(", ")}`;
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
    if (current) {
      await db.batch([
        db.prepare("DELETE FROM likes WHERE from_profile_id = ? OR to_profile_id = ?").bind(current.profile_id, current.profile_id),
        db.prepare("DELETE FROM blocks WHERE from_profile_id = ? OR to_profile_id = ?").bind(current.profile_id, current.profile_id),
        db.prepare("DELETE FROM like_events WHERE from_profile_id = ?").bind(current.profile_id),
        db.prepare("DELETE FROM profiles WHERE profile_id = ?").bind(current.profile_id),
        db.prepare("DELETE FROM conversations WHERE user_id = ?").bind(user.userId),
        db.prepare("DELETE FROM match_reports WHERE user_id = ?").bind(user.userId),
      ]);
    } else {
      await db.batch([
        db.prepare("DELETE FROM conversations WHERE user_id = ?").bind(user.userId),
        db.prepare("DELETE FROM match_reports WHERE user_id = ?").bind(user.userId),
      ]);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("profile delete failed", error);
    return jsonError("暂时无法删除，请稍后重试", 503);
  }
}
