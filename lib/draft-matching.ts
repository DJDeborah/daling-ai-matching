import type { ConversationView } from "./conversation";
import { interviewSteps, interviewTopicFields } from "./interview";
import type { DraftProfile, ProfileRow } from "./profile";

const labels: Record<string, string> = { name: "称呼", gender: "性别", age: "年龄", city: "现居城市", seeking: "想认识的性别", minAge: "期望年龄" };
const cityKey = (value: string) => value.trim().toLocaleLowerCase();

export function draftEvidence(view: ConversationView) {
  const fields = new Set(interviewSteps(view).slice(0, view.step).flatMap(step => interviewTopicFields[step.key] ?? []));
  const known = Object.fromEntries([...fields].map(key => [key, view.draft[key]]));
  return { fields, known, missingBasics: Object.keys(labels).filter(key=>!fields.has(key as keyof DraftProfile)).map(key=>labels[key]), answeredTopics: view.step };
}

export function draftEligible(view: ConversationView, other: ProfileRow): boolean {
  const { fields } = draftEvidence(view);
  const self = view.draft;
  if (fields.has("seeking") && self.seeking !== "any" && self.seeking !== other.gender) return false;
  if (fields.has("minAge") && (other.age < self.minAge || other.age > self.maxAge)) return false;
  if (fields.has("preferredCity") && self.preferredCity && cityKey(self.preferredCity) !== cityKey(other.city)) return false;
  if (fields.has("preferredHeightMin") && self.preferredHeightMin && (!other.height_cm || other.height_cm < self.preferredHeightMin)) return false;
  if (fields.has("preferredHeightMax") && self.preferredHeightMax && (!other.height_cm || other.height_cm > self.preferredHeightMax)) return false;
  if (fields.has("gender") && other.seeking !== "any" && other.seeking !== self.gender) return false;
  if (fields.has("age") && (self.age < other.min_age || self.age > other.max_age)) return false;
  if (fields.has("city") && other.preferred_city && cityKey(other.preferred_city) !== cityKey(self.city)) return false;
  if (fields.has("heightCm") && other.preferred_height_min && self.heightCm !== null && self.heightCm < other.preferred_height_min) return false;
  if (fields.has("heightCm") && other.preferred_height_max && self.heightCm !== null && self.heightCm > other.preferred_height_max) return false;
  return true;
}

export function draftMatchingDocument(view: ConversationView) {
  const { known, missingBasics } = draftEvidence(view);
  const basicKeys = ["name", "gender", "age", "city", "heightCm", "bodyType", "school", "mbti", "zodiac", "interests", "about"];
  const preferenceKeys = ["seeking", "minAge", "maxAge", "preferredCity", "preferredHeightMin", "preferredHeightMax", "preferredBodyType", "preferredZodiac", "partnerNote"];
  return { version: 3, status: "conversation_preview", answeredTopics: view.step, totalTopics: interviewSteps(view).length,
    basics: Object.fromEntries(basicKeys.map(key => [key, known[key] ?? null])),
    preferences: Object.fromEntries(preferenceKeys.map(key => [key, known[key] ?? null])),
    depth: view.draft.depth, missingBasics };
}
