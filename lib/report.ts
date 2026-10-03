import { DEMO_VERSION, demoRows } from "./demo-profiles";
import { eligible, explainMatch } from "./matching";
import { rowToInput, type DraftProfile, type ProfileRow } from "./profile";
import { compareConstraints } from "./matching-constraints";
import { depthAnswered, depthKeys, depthLabels, readMatchingDepth } from "./depth";
import type { DepthMatch } from "./compatibility";
import { unansweredTopics } from "./compatibility";
import { compareDepth } from "./compatibility";
import { draftEligible, draftEvidence } from "./draft-matching";
import type { ConversationView } from "./conversation";

export const MATCHING_VERSION = 4;

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
  eligibility: "confirmed" | "provisional" | "approximate";
  unmetConditions: string[];
  unknownConditions: string[];
};

export type MatchReport = {
  mode: "rules" | "ai";
  scope: "saved" | "preview";
  analysis: string | null;
  answeredTopics: number;
  totalTopics: number;
  missingBasics: string[];
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
    overallScore, compatibility: depth, eligibility: "confirmed", unmetConditions:[], unknownConditions:[],
  }));
  return { eligibleCount: ranked.length, candidates };
}

export function buildRuleReport(self: ProfileRow, realRows: ProfileRow[], generatedAt: string, answeredTopics = 10, totalTopics = 10): MatchReport {
  // A private profile can still preview synthetic matches without entering the real pool.
  const demo = rankCandidates({ ...self, visible: 1 }, demoRows, "demo");
  if (!demo.eligibleCount) demo.candidates = [nearestExperimental(rowToInput(self),new Set(Object.keys(rowToInput(self)) as (keyof DraftProfile)[]),self.profile_id)];
  const realStatus = self.visible === 1 && self.pool_consented_at ? "available" : "private";
  const real = realStatus === "available" ? rankCandidates(self, realRows, "real") : { eligibleCount: 0, candidates: [] };
  const summary = demo.eligibleCount
    ? `从 ${demoRows.length} 份实验档案中，找到 ${demo.eligibleCount} 份符合双方基本条件的体验候选。下面呈现前 ${demo.candidates.length} 份，帮助你了解共同点、差异和还值得聊的细节。`
    : `当前没有完全符合双向基本条件的体验候选。我们从 ${demoRows.length} 份实验档案中，选出相对最接近的一位供你了解，并列出尚未满足的条件。`;
  const selfDepth = readMatchingDepth(self.matching_json);
  return {
    mode: "rules", scope: "saved", analysis: null, answeredTopics, totalTopics, missingBasics: [],
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
    note: "相符度来自已提供资料的比较，不预测关系结果。待了解的内容不扣分；体验候选来自实验档案，不提供联系。",
    matchingVersion: MATCHING_VERSION,
    myDepth: { answered: depthAnswered(selfDepth), total: depthKeys.length,
      summaries: depthKeys.filter(key=>selfDepth.topics[key]?.status === "answered").map(key=>({ label:depthLabels[key],summary:selfDepth.topics[key]!.summary })),
      unanswered: unansweredTopics(selfDepth) },
  };
}

function experimentalEvidence(self: DraftProfile, known: Set<keyof DraftProfile>, other: ProfileRow) {
  const sameCity = known.has("city") ? self.city.trim().toLocaleLowerCase() === other.city.trim().toLocaleLowerCase() : null;
  const compatibility = compareDepth(self.depth,readMatchingDepth(other.matching_json),sameCity);
  const common = known.has("interests") ? self.interests.filter(tag=>readInterests(other).some(item=>item.toLocaleLowerCase()===tag.toLocaleLowerCase())) : [];
  const reasons: string[] = [];
  if (sameCity) reasons.push("同城生活");
  if (common.length) reasons.push(`共同兴趣：${common.slice(0,2).join("、")}`);
  const aligned = compatibility.dimensions.filter(item=>item.score !== null && item.score >= 75);
  if (aligned.length) reasons.push(`已知相处共同点：${aligned.map(item=>item.label).join("、")}`);
  if (!reasons.length) reasons.push("先了解这位候选的具体生活与相处方式，已知共同点仍待确认");
  const affinity = (compatibility.score ?? 0)*compatibility.coverage/100 + (sameCity ? 20 : 0) + common.length*8 + (known.has("age") ? Math.max(0,12-Math.abs(self.age-other.age)) : 0);
  return { other, compatibility, reasons, score:compatibility.score, affinity, ...compareConstraints(self,other,known) };
}

function nearestExperimental(self: DraftProfile, known: Set<keyof DraftProfile>, excludeId = ""): ReportCandidate {
  const entries = demoRows.filter(row=>row.profile_id !== excludeId).map(row=>experimentalEvidence(self,known,row));
  entries.sort((a,b)=>a.unmetConditions.length-b.unmetConditions.length || a.priorityPenalty-b.priorityPenalty || a.unknownConditions.length-b.unknownConditions.length || b.affinity-a.affinity || a.other.profile_id.localeCompare(b.other.profile_id));
  const first = entries[0];
  return {id:first.other.profile_id,source:"demo",name:first.other.name,age:first.other.age,city:first.other.city,interests:readInterests(first.other),about:first.other.about,reasons:first.reasons,rank:1,narrative:null,overallScore:first.score,compatibility:first.compatibility,eligibility:"approximate",unmetConditions:first.unmetConditions,unknownConditions:first.unknownConditions};
}

export function buildDraftReport(view: ConversationView, generatedAt: string): MatchReport {
  const { fields, missingBasics } = draftEvidence(view);
  const self = view.draft;
  const ranked = demoRows.filter(other => draftEligible(view, other)).map(other => {
    const sameCity = fields.has("city") ? self.city.trim().toLocaleLowerCase() === other.city.trim().toLocaleLowerCase() : null;
    const compatibility = compareDepth(self.depth, readMatchingDepth(other.matching_json), sameCity);
    const common = fields.has("interests") ? self.interests.filter(tag => readInterests(other).includes(tag)) : [];
    const reasons: string[] = [];
    if (sameCity) reasons.push("同城生活");
    if (common.length) reasons.push(`共同兴趣：${common.slice(0, 2).join("、")}`);
    if (fields.has("seeking") && self.seeking !== "any") reasons.push("符合认识对象的性别偏好");
    if (fields.has("minAge")) reasons.push("在你期待的年龄范围内");
    const aligned = compatibility.dimensions.filter(item => item.score !== null && item.score >= 75);
    if (aligned.length) reasons.push(`相处共同点：${aligned.slice(0, 2).map(item => item.label).join("、")}`);
    if (!reasons.length) reasons.push("先看看不同的生活与相处方式");
    const basicRank = (sameCity ? 20 : 0) + common.length * 8 + (fields.has("age") ? Math.max(0, 12 - Math.abs(self.age - other.age)) : 0);
    const score = compatibility.score;
    const rank = (score ?? 0) * compatibility.coverage + basicRank;
    return { other, compatibility, reasons, score, rank };
  }).sort((a, b) => b.rank - a.rank || a.other.profile_id.localeCompare(b.other.profile_id));
  const candidates: ReportCandidate[] = ranked.slice(0, 5).map(({ other, compatibility, reasons, score }, index) => ({
    id: other.profile_id, source: "demo", name: other.name, age: other.age, city: other.city, interests: readInterests(other), reasons,
    about: other.about, rank: index + 1, narrative: null, overallScore: score, compatibility, eligibility: missingBasics.length || compareConstraints(self,other,fields).unknownConditions.length ? "provisional" : "confirmed", unmetConditions:[], unknownConditions:compareConstraints(self,other,fields).unknownConditions,
  }));
  if (!candidates.length) candidates.push(nearestExperimental(self,fields));
  return { mode: "rules", scope: "preview", analysis: null, generatedAt, profileUpdatedAt: view.revision, demoVersion: DEMO_VERSION,
    answeredTopics: view.step, totalTopics:view.totalSteps, missingBasics, summary: !ranked.length ? `现有实验档案中暂没有完全满足已知条件的候选。先给你相对最接近的一位，并说明差距；未回答的信息仍然留白。` : view.step ? `根据已经聊过的 ${view.step} 个话题，为你找到 ${ranked.length} 份符合已知条件的体验候选。还没聊到的部分先留白，之后随时可以补充。` : "可以先看看不同的生活与相处方式。你还没有提供个人偏好，目前展示体验候选，不做个人相符度评分。",
    demoPoolSize: demoRows.length, demoEligibleCount: ranked.length, demoCandidates: candidates,
    realStatus: "private", realEligibleCount: 0, realCandidates: [],
    note: "这是根据当前对话形成的匹配预览。未知条件保持待了解；实验档案用于体验，不对应站内报名者，也不提供联系。",
    matchingVersion: MATCHING_VERSION,
    myDepth: { answered: depthAnswered(self.depth), total: depthKeys.length,
      summaries: depthKeys.filter(key => self.depth.topics[key]?.status === "answered").map(key => ({ label: depthLabels[key], summary: self.depth.topics[key]!.summary })),
      unanswered: unansweredTopics(self.depth) },
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
  return { ...report, mode: "ai", analysis: text.summary, demoCandidates: candidates };
}
