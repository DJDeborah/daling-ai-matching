import { DEMO_VERSION, demoRows } from "./demo-profiles";
import { eligible, explainMatch } from "./matching";
import type { ProfileRow } from "./profile";
import { depthAnswered, depthKeys, depthLabels, readMatchingDepth } from "./depth";
import type { DepthMatch } from "./compatibility";
import { unansweredTopics } from "./compatibility";

export const MATCHING_VERSION = 2;

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
  overallScore: number | null;
  compatibility: DepthMatch;
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
  matchingVersion: number;
  myDepth: { answered: number; total: number; summaries: { label: string; summary: string }[]; unanswered: string[] };
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
  const candidates: ReportCandidate[] = ranked.slice(0, 5).map(({ row, reasons, depth, overallScore }, index) => ({
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
    overallScore, compatibility: depth,
  }));
  return { eligibleCount: ranked.length, candidates };
}

export function buildRuleReport(self: ProfileRow, realRows: ProfileRow[], generatedAt: string): MatchReport {
  // A private profile can still preview synthetic matches without entering the real pool.
  const demo = rankCandidates({ ...self, visible: 1 }, demoRows, "demo");
  const realStatus = self.visible === 1 && self.pool_consented_at ? "available" : "private";
  const real = realStatus === "available" ? rankCandidates(self, realRows, "real") : { eligibleCount: 0, candidates: [] };
  const summary = demo.eligibleCount
    ? `在 ${demoRows.length} 份虚构演示资料中，有 ${demo.eligibleCount} 份通过双方的基础条件。我们再整体比较价值观、沟通、支持、节奏、未来和边界，显示前 ${demo.candidates.length} 份。资料越完整，深度比较的依据越充分。`
    : `按当前双方条件，${demoRows.length} 份虚构演示资料中暂无合适对象。可以检查年龄、城市和身高范围；不必为了获得结果修改自己的真实偏好。`;
  const selfDepth = readMatchingDepth(self.matching_json);
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
    note: "资料相符度来自已确认 JSON 的规则比较，权重为产品设定；分数不预测恋爱结果。未知项不扣分，低覆盖度意味着还需要了解彼此。虚构样例不能联系。",
    matchingVersion: MATCHING_VERSION,
    myDepth: { answered: depthAnswered(selfDepth), total: depthKeys.length,
      summaries: depthKeys.filter(key=>selfDepth.topics[key]?.status === "answered").map(key=>({ label:depthLabels[key],summary:selfDepth.topics[key]!.summary })),
      unanswered: unansweredTopics(selfDepth) },
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
