import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, ownProfile } from "@/lib/database";
import { eligible, explainMatch } from "@/lib/matching";
import { rowToInput, type ProfileRow } from "@/lib/profile";

export const runtime = "edge";

type Pair = { from_profile_id: string; to_profile_id: string };

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  try {
    const db = database();
    const self = await ownProfile(db, user.userId);
    if (!self) return Response.json({ profile: null, candidates: [], matches: [] }, { headers: { "Cache-Control": "no-store" } });
    if (self.visible !== 1) return Response.json({ profile: rowToInput(self), candidates: [], matches: [] }, { headers: { "Cache-Control": "no-store" } });

    const [poolResult, matchResult, likesResult, blocksResult] = await Promise.all([
      db.prepare("SELECT * FROM profiles WHERE visible = 1 AND profile_id != ? ORDER BY updated_at DESC LIMIT 1000")
        .bind(self.profile_id).all<ProfileRow>(),
      db.prepare("SELECT p.* FROM likes mine JOIN likes theirs ON theirs.from_profile_id = mine.to_profile_id AND theirs.to_profile_id = mine.from_profile_id JOIN profiles p ON p.profile_id = mine.to_profile_id WHERE mine.from_profile_id = ? AND p.visible = 1")
        .bind(self.profile_id).all<ProfileRow>(),
      db.prepare("SELECT from_profile_id, to_profile_id FROM likes WHERE from_profile_id = ? OR to_profile_id = ?")
        .bind(self.profile_id, self.profile_id).all<Pair>(),
      db.prepare("SELECT from_profile_id, to_profile_id FROM blocks WHERE from_profile_id = ? OR to_profile_id = ?")
        .bind(self.profile_id, self.profile_id).all<Pair>(),
    ]);
    const outgoing = new Set(likesResult.results.filter(x => x.from_profile_id === self.profile_id).map(x => x.to_profile_id));
    const incoming = new Set(likesResult.results.filter(x => x.to_profile_id === self.profile_id).map(x => x.from_profile_id));
    const blocked = new Set(blocksResult.results.map(x => x.from_profile_id === self.profile_id ? x.to_profile_id : x.from_profile_id));
    const ranked = poolResult.results
      .filter(other => !blocked.has(other.profile_id) && eligible(self, other))
      .map(other => ({ other, ...explainMatch(self, other) }))
      .sort((a, b) => b.rank - a.rank || b.other.updated_at.localeCompare(a.other.updated_at));
    const candidates = ranked.slice(0, 60).map(({ other, reasons }) => ({
      id: other.profile_id, name: other.name, age: other.age, city: other.city,
      heightCm: other.height_cm, bodyType: other.body_type, school: other.school,
      mbti: other.mbti, zodiac: other.zodiac, interests: rowToInput(other).interests,
      about: other.about, partnerNote: other.partner_note, reasons,
      liked: outgoing.has(other.profile_id), mutual: outgoing.has(other.profile_id) && incoming.has(other.profile_id),
    }));
    const matches = matchResult.results.filter(other => !blocked.has(other.profile_id) && eligible(self, other)).map(other => ({
      id: other.profile_id, name: other.name, age: other.age, city: other.city,
      heightCm: other.height_cm, bodyType: other.body_type, school: other.school,
      mbti: other.mbti, zodiac: other.zodiac, interests: rowToInput(other).interests,
      about: other.about, partnerNote: other.partner_note, reasons: explainMatch(self, other).reasons,
      liked: true, mutual: true,
      contactKind: self.contact_share === 1 && other.contact_share === 1 ? other.contact_kind : null,
      contactValue: self.contact_share === 1 && other.contact_share === 1 ? other.contact_value : null,
    }));
    return Response.json({ profile: rowToInput(self), candidates, matches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("state load failed", error);
    return jsonError("暂时无法读取资料，请稍后重试", 503);
  }
}
