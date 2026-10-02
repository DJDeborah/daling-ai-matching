import type { ProfileRow } from "./profile";
import { readMatchingDepth } from "./depth";
import { compareDepth } from "./compatibility";

function wants(person: ProfileRow, other: ProfileRow) {
  if (person.seeking !== "any" && person.seeking !== other.gender) return false;
  if (other.age < person.min_age || other.age > person.max_age) return false;
  if (person.preferred_city && person.preferred_city.trim().toLocaleLowerCase() !== other.city.trim().toLocaleLowerCase()) return false;
  if (person.preferred_height_min && (!other.height_cm || other.height_cm < person.preferred_height_min)) return false;
  if (person.preferred_height_max && (!other.height_cm || other.height_cm > person.preferred_height_max)) return false;
  return true;
}

export function eligible(a: ProfileRow, b: ProfileRow) {
  return a.profile_id !== b.profile_id && a.visible === 1 && b.visible === 1 && wants(a, b) && wants(b, a);
}

function interests(row: ProfileRow): string[] {
  try {
    const value: unknown = JSON.parse(row.interests_json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch { return []; }
}

export function explainMatch(a: ProfileRow, b: ProfileRow) {
  const common = interests(a).filter(x => interests(b).some(y => y.toLocaleLowerCase() === x.toLocaleLowerCase()));
  const reasons: string[] = ["双方条件符合"];
  let rank = 0;
  if (a.city.trim().toLocaleLowerCase() === b.city.trim().toLocaleLowerCase()) {
    reasons.push("同城"); rank += 20;
  }
  if (common.length) {
    reasons.push(`共同兴趣：${common.slice(0, 2).join("、")}`); rank += Math.min(24, common.length * 8);
  }
  rank += Math.max(0, 12 - Math.abs(a.age - b.age));
  if (a.preferred_body_type && a.preferred_body_type === b.body_type) rank += 3;
  if (b.preferred_body_type && b.preferred_body_type === a.body_type) rank += 3;
  const depth = compareDepth(readMatchingDepth(a.matching_json), readMatchingDepth(b.matching_json), a.city.trim().toLocaleLowerCase() === b.city.trim().toLocaleLowerCase());
  // An unknown topic is neutral, never an automatic rejection. Evidence coverage limits its effect.
  const aligned = depth.dimensions.filter(item => item.score !== null && item.score >= 75).map(item=>item.label);
  if (aligned.length) reasons.push(`深度相符：${aligned.slice(0,2).join("、")}`);
  const basicScore = Math.min(100, Math.round(50 + (common.length ? Math.min(30,common.length*10) : 0) + (a.city === b.city ? 20 : 0)));
  const overallScore = depth.score === null ? null : Math.round(basicScore*(1-.7*depth.coverage/100)+depth.score*.7*depth.coverage/100);
  const rankingScore = overallScore ?? basicScore;
  return { rank: rankingScore*1000+rank, reasons, depth, overallScore };
}
