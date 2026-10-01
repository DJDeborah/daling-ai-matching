import { DEMO_VERSION, demoRows } from "./demo-profiles";
import { eligible, explainMatch } from "./matching";
import type { ProfileRow } from "./profile";

export type ReportCandidate = {
  id: string;
  source: "demo" | "real";
  name: string;
  age: number;
  city: string;
  interests: string[];
  reasons: string[];
  about: string;
  rank: number;
  narrative: string | null;
};

export type MatchReport = {
  mode: "rules" | "ai";
  generatedAt: string;
  profileUpdatedAt: string;
  demoVersion: number;
  summary: string;
  demoPoolSize: number;
  demoEligibleCount: number;
  demoCandidates: ReportCandidate[];
  realStatus: "available" | "private";
  realEligibleCount: number;
  realCandidates: ReportCandidate[];
  note: string;
};

export type AiReportText = {
  summary: string;
  narratives: { id: string; narrative: string }[];
};

function readInterests(row: ProfileRow): string[] {
  try {
    const parsed: unknown = JSON.parse(row.interests_json);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rankCandidates(self: ProfileRow, rows: ProfileRow[], source: ReportCandidate["source"]) {
  const ranked = rows
    .filter(other => eligible(self, other))
    .map(other => ({ row: other, ...explainMatch(self, other) }))
    .sort((a, b) => b.rank - a.rank || (source === "real" ? b.row.updated_at.localeCompare(a.row.updated_at) : a.row.profile_id.localeCompare(b.row.profile_id)));
  const candidates: ReportCandidate[] = ranked.slice(0, 5).map(({ row, reasons }, index) => ({
    id: row.profile_id,
    source,
    name: row.name,
    age: row.age,
    city: row.city,
    interests: readInterests(row),
    reasons,
    about: row.about,
    rank: index + 1,
    narrative: null,
  }));
  return { eligibleCount: ranked.length, candidates };
}

export function buildRuleReport(self: ProfileRow, realRows: ProfileRow[], generatedAt: string): MatchReport {
  // A private profile can still preview synthetic matches without entering the real pool.
  const demo = rankCandidates({ ...self, visible: 1 }, demoRows, "demo");
  const realStatus = self.visible === 1 && self.pool_consented_at ? "available" : "private";
  const real = realStatus === "available" ? rankCandidates(self, realRows, "real") : { eligibleCount: 0, candidates: [] };
  const summary = demo.eligibleCount
    ? `在 ${demoRows.length} 份虚构演示资料中，有 ${demo.eligibleCount} 份通过双方的性别、年龄、城市和身高条件筛选。以下显示前 ${demo.candidates.length} 份，排序依据是同城、共同兴趣及少量可选偏好。`
    : `按当前双方条件，${demoRows.length} 份虚构演示资料中暂无合适对象。可以检查年龄、城市和身高范围；不必为了获得结果修改自己的真实偏好。`;
  return {
    mode: "rules",
    generatedAt,
    profileUpdatedAt: self.updated_at,
    demoVersion: DEMO_VERSION,
    summary,
    demoPoolSize: demoRows.length,
    demoEligibleCount: demo.eligibleCount,
    demoCandidates: demo.candidates,
    realStatus,
    realEligibleCount: real.eligibleCount,
    realCandidates: real.candidates,
    note: "演示资料全部虚构，仅用于体验匹配规则，不能点赞或联系。真实候选人单独展示；排序不代表恋爱成功率。",
  };
}

export function applyAiText(report: MatchReport, text: AiReportText): MatchReport | null {
  const expected = report.demoCandidates.map(candidate => candidate.id);
  if (text.narratives.length !== expected.length ||
      new Set(text.narratives.map(item => item.id)).size !== expected.length ||
      text.narratives.some(item => !expected.includes(item.id))) return null;
  const narrativeById = new Map(text.narratives.map(item => [item.id, item.narrative]));
  const candidates = report.demoCandidates.map(candidate => ({
    ...candidate,
    narrative: narrativeById.get(candidate.id) ?? null,
  }));
  return { ...report, mode: "ai", summary: `演示资料模拟结果：${text.summary}`, demoCandidates: candidates };
}
