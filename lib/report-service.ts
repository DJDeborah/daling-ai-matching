import { env } from "cloudflare:workers";
import { releaseAiCall, reserveAiCall } from "./ai";
import { ownProfile } from "./database";
import { loadConversation, ConversationConflict } from "./conversation";
import { draftEvidence } from "./draft-matching";
import type { ProfileRow } from "./profile";
import { applyAiText, buildDraftReport, buildRuleReport, type MatchReport } from "./report";
import { generateAiReportText, parseAiReportText } from "./report-ai";
export type AiStatus = "not_requested" | "generated" | "cached" | "fallback" | "unavailable" | "limit_reached";
type CachedReport = { profile_updated_at: string; demo_version: number; report_json: string };
export type ReportResult = { report: MatchReport; aiAvailable: boolean; aiStatus: AiStatus };
export async function loadReport(db: D1Database, userId: string) {
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
  return { report: buildRuleReport(self, realRows, new Date().toISOString(), view.status === "complete" ? view.step : view.totalSteps,view.totalSteps), context: { interests, partnerNote: self.partner_note } };
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


function result(report: MatchReport, aiStatus: AiStatus): ReportResult {
  return { report, aiAvailable: Boolean(env.DEEPSEEK_API_KEY), aiStatus };
}
export async function getMatchingReport(db: D1Database, userId: string): Promise<ReportResult> {
  const loaded = await loadReport(db, userId);
  const cached = await cachedAiText(db, userId, loaded.report);
  const enriched = cached && applyAiText(loaded.report, cached);
  return result(enriched || loaded.report, enriched ? "cached" : "not_requested");
}
// Callers must obtain explicit consent before invoking this function.
export async function analyzeMatchingReport(db: D1Database, userId: string, input: { refresh?: boolean; revision?: string } = {}): Promise<ReportResult> {
  let loaded: Awaited<ReturnType<typeof loadReport>>;
  loaded = await loadReport(db, userId);
    if (input.revision && input.revision !== loaded.report.profileUpdatedAt) throw new ConversationConflict("资料已更新，请重新加载当前报告");
    if (!input.refresh) {
      const cache = await cachedAiText(db, userId, loaded.report);
      const enriched = cache && applyAiText(loaded.report, cache);
      if (enriched) return result(enriched, "cached");
    }
    if (!env.DEEPSEEK_API_KEY) return result(loaded.report, "unavailable");

  let eventId: string | null = null;
  try {
    eventId = await reserveAiCall(db, userId);
    if (!eventId) return result(loaded.report, "limit_reached");
    const text = await generateAiReportText(loaded.report, loaded.context);
    const enriched = text && applyAiText(loaded.report, text);
    if (!text || !enriched) throw new Error("Invalid AI report");
    const guardTable = loaded.report.scope === "preview" ? "conversations" : "profiles";
    const table = loaded.report.scope === "preview" ? "draft_match_reports" : "match_reports";
    const guard = `EXISTS (SELECT 1 FROM ${guardTable} WHERE user_id = ? AND updated_at = ?)`;
    const stored = await db.prepare(`INSERT INTO ${table} (user_id, profile_updated_at, demo_version, report_json, created_at)
      SELECT ?, ?, ?, ?, ? WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET profile_updated_at = excluded.profile_updated_at,
      demo_version = excluded.demo_version, report_json = excluded.report_json, created_at = excluded.created_at`)
      .bind(userId, loaded.report.profileUpdatedAt, loaded.report.demoVersion, JSON.stringify({ matchingVersion: loaded.report.matchingVersion, scope: loaded.report.scope, text }), new Date().toISOString(), userId, loaded.report.profileUpdatedAt).run();
    if (!stored.meta.changes) { await releaseAiCall(db, eventId); throw new ConversationConflict("资料已更新，请重新加载当前报告"); }
    return result(enriched, "generated");
  } catch (error) {
    if (error instanceof ConversationConflict) throw error;
    if (eventId) await releaseAiCall(db, eventId);
    console.error("AI report failed", error instanceof Error ? error.name : "unknown");
    return result(loaded.report, "fallback");
  }
}
