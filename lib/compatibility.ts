import { depthKeys, depthLabels, type DepthKey, type DepthProfile } from "./depth";

export type MatchDimension = { key: DepthKey; label: string; score: number | null; evidence: string; discussion: string | null; coverage: number };
export type DepthMatch = { score: number | null; coverage: number; dimensions: MatchDimension[]; discussions: string[] };
const weights: Record<DepthKey, number> = { values: 25, conflict: 15, support: 20, rhythm: 15, future: 15, boundaries: 10 };
const discussionQuestions: Record<DepthKey, string> = {
  values: "彼此最在意的价值观，怎样在日常选择里体现？",
  conflict: "需要冷静时，多久之后再回来谈会让双方安心？",
  support: "情绪低落时，怎样让对方知道现在需要倾听还是行动？",
  rhythm: "忙碌的一周里，怎样安排联系和独处会让双方舒服？",
  future: "关系方向、婚育或居住安排里，哪些是确定的，哪些可以商量？",
  boundaries: "隐私、关系节奏和消费边界，怎样约定才能彼此尊重？",
};
const overlap = (a: string[], b: string[]) => a.length && b.length ? 100 * a.filter(x => b.includes(x)).length / Math.max(a.length, b.length) : null;
const needsMet = (needs: string[], offers: string[]) => needs.length && offers.length ? 100 * needs.filter(x => offers.includes(x)).length / needs.length : null;
function style(a: string | null, acceptsA: string[], b: string | null, acceptsB: string[]): number | null {
  if (!a || !b) return null;
  const side = (actual: string, accepted: string[]) => accepted.includes(actual) ? 100 : accepted.length ? 0 : a === b ? 100 : 50;
  return (side(b, acceptsA) + side(a, acceptsB)) / 2;
}
function intention(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return a === b || a === "open" || b === "open" || a === "discuss" || b === "discuss" ? 100 : 0;
}
function dimension(key: DepthKey, components: (number | null)[], evidence: string): MatchDimension {
  const known = components.filter((v): v is number => v !== null);
  const score = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null;
  return { key, label: depthLabels[key], score, coverage: components.length ? known.length / components.length : 0,
    evidence: score === null ? "双方明确资料不足，暂不评分" : evidence,
    discussion: score !== null && score < 75 ? discussionQuestions[key] : null };
}
function answered<T extends { status: string }>(topic: T | undefined): T | undefined { return topic?.status === "answered" ? topic : undefined; }

export function compareDepth(a: DepthProfile, b: DepthProfile, sameCity = true): DepthMatch {
  const av=answered(a.topics.values), bv=answered(b.topics.values);
  const ac=answered(a.topics.conflict), bc=answered(b.topics.conflict);
  const as=answered(a.topics.support), bs=answered(b.topics.support);
  const ar=answered(a.topics.rhythm), br=answered(b.topics.rhythm);
  const af=answered(a.topics.future), bf=answered(b.topics.future);
  const ab=answered(a.topics.boundaries), bb=answered(b.topics.boundaries);
  const dimensions: MatchDimension[] = [
    dimension("values", [av && bv ? overlap(av.priorities,bv.priorities) : null], "依据双方明确列出的关系价值优先项"),
    dimension("conflict", [ac && bc ? style(ac.approach,ac.accepts,bc.approach,bc.accepts) : null, ac && bc ? overlap(ac.repairNeeds,bc.repairNeeds) : null], "依据沟通时机、明确接受的方式与修复需求"),
    dimension("support", [as && bs ? needsMet(as.needs,bs.offers) : null, as && bs ? needsMet(bs.needs,as.offers) : null], "分别比较你的需要与对方的付出、对方的需要与你的付出"),
    dimension("rhythm", [ar && br ? style(ar.contact,ar.acceptsContact,br.contact,br.acceptsContact) : null, ar && br ? style(ar.time,ar.acceptsTime,br.time,br.acceptsTime) : null], "依据联系节奏、共同时间及双方明确可接受的安排"),
    dimension("future", [af && bf ? style(af.goal,af.acceptsGoals,bf.goal,bf.acceptsGoals) : null, af && bf ? intention(af.marriage,bf.marriage) : null, af && bf ? intention(af.children,bf.children) : null, af && bf ? !sameCity && af.relocation === "stay" && bf.relocation === "stay" ? 0 : intention(af.relocation,bf.relocation) : null], "仅比较明确表达的关系、婚育与迁居计划，未知项不计分"),
    dimension("boundaries", [ab && bb ? style(ab.privacy,ab.acceptsPrivacy,bb.privacy,bb.acceptsPrivacy) : null, ab && bb ? style(ab.pace,ab.acceptsPace,bb.pace,bb.acceptsPace) : null, ab && bb ? style(ab.money,ab.acceptsMoney,bb.money,bb.acceptsMoney) : null], "依据明确表达的隐私、推进节奏和消费方式"),
  ];
  let knownWeight=0,total=0;
  for(const item of dimensions) if(item.score !== null) { const weight=weights[item.key]*item.coverage; knownWeight+=weight; total+=item.score*weight; }
  return { score: knownWeight ? Math.round(total/knownWeight) : null, coverage: Math.round(knownWeight), dimensions,
    discussions: dimensions.filter(x=>x.discussion).map(x=>x.discussion!).slice(0,3) };
}

export function unansweredTopics(depth: DepthProfile) { return depthKeys.filter(key => depth.topics[key]?.status !== "answered").map(key => depthLabels[key]); }
