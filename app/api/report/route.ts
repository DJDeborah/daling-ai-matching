import { env } from "cloudflare:workers";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { releaseAiCall, reserveAiCall } from "@/lib/ai";
import { database, jsonError, ownProfile, sameOrigin } from "@/lib/database";
import { loadConversation } from "@/lib/conversation";
import { draftEvidence } from "@/lib/draft-matching";
import type { ProfileRow } from "@/lib/profile";
import { applyAiText, buildDraftReport, buildRuleReport, type MatchReport } from "@/lib/report";
import { generateAiReportText, parseAiReportText } from "@/lib/report-ai";

export const runtime = "edge";
type AiStatus = "not_requested" | "generated" | "cached" | "fallback" | "unavailable" | "limit_reached";
type CachedReport = { profile_updated_at: string; demo_version: number; report_json: string };

function noStore(report: MatchReport, aiStatus: AiStatus) {
  return Response.json({ report, aiAvailable: Boolean(env.DEEPSEEK_API_KEY), aiStatus }, { headers: { "Cache-Control": "no-store" } });
}

async function loadReport(db: D1Database, userId: string) {
  const [self, view] = await Promise.all([ownProfile(db, userId), loadConversation(db, userId)]);
  if (view.status === "paused" || !self) {
    const { fields } = draftEvidence(view);
    return { report: buildDraftReport(view, new Date().toISOString()), context: { interests: fields.has("interests") ? view.draft.interests : [], partnerNote: fields.has("partnerNote") ? view.draft.partnerNote : "" } };
  }
  let realRows: ProfileRow[] = [];
  if (self.visible === 1 && self.pool_consented_at) {
    const [pool, blocks] = await Promise.all([
      db.prepare("SELECT * FROM profiles WHERE visible = 1 AND pool_consented_at IS NOT NULL AND profile_id != ? ORDER BY updated_at DESC LIMIT 1000").bind(self.profile_id).all<ProfileRow>(),
      db.prepare("SELECT from_profile_id, to_profile_id FROM blocks WHERE from_profile_id = ? OR to_profile_id = ?").bind(self.profile_id, self.profile_id).all<{ from_profile_id: string; to_profile_id: string }>(),
    ]);
    const blocked = new Set(blocks.results.map(pair => pair.from_profile_id === self.profile_id ? pair.to_profile_id : pair.from_profile_id));
    realRows = pool.results.filter(row => !blocked.has(row.profile_id));
  }
  let interests: string[] = [];
  try { const raw: unknown = JSON.parse(self.interests_json); if (Array.isArray(raw)) interests = raw.filter((item): item is string => typeof item === "string").slice(0, 8); } catch { /* Keep damaged legacy data out of model context. */ }
  return { report: buildRuleReport(self, realRows, new Date().toISOString(), view.status === "complete" ? view.step : 19), context: { interests, partnerNote: self.partner_note } };
}

async function cachedAiText(db: D1Database, userId: string, report: MatchReport) {
  const table = report.scope === "preview" ? "draft_match_reports" : "match_reports";
  const cached = await db.prepare(`SELECT profile_updated_at, demo_version, report_json FROM ${table} WHERE user_id = ?`).bind(userId).first<CachedReport>();
  if (!cached || cached.profile_updated_at !== report.profileUpdatedAt || cached.demo_version !== report.demoVersion) return null;
  try {
    const payload = JSON.parse(cached.report_json);
    return payload.matchingVersion === report.matchingVersion && payload.scope === report.scope ? parseAiReportText(payload.text) : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  try {
    const db = database();
    const loaded = await loadReport(db, user.userId);
    const cached = await cachedAiText(db, user.userId, loaded.report);
    const enriched = cached && applyAiText(loaded.report, cached);
    return noStore(enriched || loaded.report, enriched ? "cached" : "not_requested");
  } catch { return jsonError("暂时无法加载匹配报告，请点击重新加载", 503); }
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  let input: { consent: true; refresh?: boolean; revision?: string };
  try {
    const raw = await request.text();
    if (raw.length > 400) return jsonError("请求内容过长", 413);
    const parsed = z.object({ consent: z.literal(true), refresh: z.boolean().optional(), revision: z.string().max(100).optional() }).strict().safeParse(JSON.parse(raw));
    if (!parsed.success) return jsonError("请先确认将精简匹配资料发给 AI 分析", 400);
    input = parsed.data;
  } catch { return jsonError("请求内容无效", 400); }
  const db = database();
  let loaded: Awaited<ReturnType<typeof loadReport>>;
  try {
    loaded = await loadReport(db, user.userId);
    if (input.revision && input.revision !== loaded.report.profileUpdatedAt) return jsonError("资料已更新，请重新加载当前报告", 409);
    if (!input.refresh) {
      const cache = await cachedAiText(db, user.userId, loaded.report);
      const enriched = cache && applyAiText(loaded.report, cache);
      if (enriched) return noStore(enriched, "cached");
    }
    if (!env.DEEPSEEK_API_KEY) return noStore(loaded.report, "unavailable");
  } catch { return jsonError("暂时无法加载匹配报告", 503); }

  let eventId: string | null = null;
  try {
    eventId = await reserveAiCall(db, user.userId);
    if (!eventId) return noStore(loaded.report, "limit_reached");
    const text = await generateAiReportText(loaded.report, loaded.context);
    const enriched = text && applyAiText(loaded.report, text);
    if (!text || !enriched) throw new Error("Invalid AI report");
    const guardTable = loaded.report.scope === "preview" ? "conversations" : "profiles";
    const table = loaded.report.scope === "preview" ? "draft_match_reports" : "match_reports";
    const guard = `EXISTS (SELECT 1 FROM ${guardTable} WHERE user_id = ? AND updated_at = ?)`;
    const stored = await db.prepare(`INSERT INTO ${table} (user_id, profile_updated_at, demo_version, report_json, created_at)
      SELECT ?, ?, ?, ?, ? WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET profile_updated_at = excluded.profile_updated_at,
      demo_version = excluded.demo_version, report_json = excluded.report_json, created_at = excluded.created_at`)
      .bind(user.userId, loaded.report.profileUpdatedAt, loaded.report.demoVersion, JSON.stringify({ matchingVersion: loaded.report.matchingVersion, scope: loaded.report.scope, text }), new Date().toISOString(), user.userId, loaded.report.profileUpdatedAt).run();
    if (!stored.meta.changes) { await releaseAiCall(db, eventId); return jsonError("资料已更新，请重新加载当前报告", 409); }
    return noStore(enriched, "generated");
  } catch (error) {
    if (eventId) await releaseAiCall(db, eventId);
    console.error("AI report failed", error instanceof Error ? error.name : "unknown");
    return noStore(loaded.report, "fallback");
  }
}
