import type { ProfileRow } from "./profile";

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
  if (a.preferred_zodiac && a.preferred_zodiac === b.zodiac) rank += 2;
  if (b.preferred_zodiac && b.preferred_zodiac === a.zodiac) rank += 2;
  return { rank, reasons };
}
