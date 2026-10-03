import type { ConversationView } from "./conversation";
import { conversationSteps } from "./interview";
import type { DraftProfile, ProfileRow } from "./profile";

const topicFields: Record<string, (keyof DraftProfile)[]> = {
  name: ["name"], gender: ["gender"], age: ["age"], city: ["city"], seeking: ["seeking"], ageRange: ["minAge", "maxAge"],
  preferredCity: ["preferredCity"], heightCm: ["heightCm"], partnerHeightAndBody: ["preferredHeightMin", "preferredHeightMax", "bodyType", "preferredBodyType"],
  interests: ["interests"], about: ["about"], partnerNote: ["partnerNote"], details: ["school", "mbti", "zodiac", "preferredZodiac"],
};
const labels: Record<string, string> = { name: "称呼", gender: "性别", age: "年龄", city: "现居城市", seeking: "想认识的性别", ageRange: "期望年龄" };

export function draftEvidence(view: ConversationView) {
  const fields = new Set(conversationSteps.slice(0, view.step).flatMap(step => topicFields[step.key] ?? []));
  const known = Object.fromEntries([...fields].map(key => [key, view.draft[key]]));
  return { fields, known, missingBasics: conversationSteps.slice(0, 6).filter((_, index) => index >= view.step).map(step => labels[step.key]), answeredTopics: view.step };
}

export function draftEligible(view: ConversationView, other: ProfileRow): boolean {
  const { fields } = draftEvidence(view);
  const self = view.draft;
  if (fields.has("seeking") && self.seeking !== "any" && self.seeking !== other.gender) return false;
  if (fields.has("minAge") && (other.age < self.minAge || other.age > self.maxAge)) return false;
  if (fields.has("preferredCity") && self.preferredCity && self.preferredCity !== other.city) return false;
  if (fields.has("preferredHeightMin") && self.preferredHeightMin && (!other.height_cm || other.height_cm < self.preferredHeightMin)) return false;
  if (fields.has("preferredHeightMax") && self.preferredHeightMax && (!other.height_cm || other.height_cm > self.preferredHeightMax)) return false;
  if (fields.has("gender") && other.seeking !== "any" && other.seeking !== self.gender) return false;
  if (fields.has("age") && (self.age < other.min_age || self.age > other.max_age)) return false;
  if (fields.has("city") && other.preferred_city && other.preferred_city !== self.city) return false;
  if (fields.has("heightCm") && other.preferred_height_min && self.heightCm !== null && self.heightCm < other.preferred_height_min) return false;
  if (fields.has("heightCm") && other.preferred_height_max && self.heightCm !== null && self.heightCm > other.preferred_height_max) return false;
  return true;
}

export function draftMatchingDocument(view: ConversationView) {
  const { known, missingBasics } = draftEvidence(view);
  const basicKeys = ["name", "gender", "age", "city", "heightCm", "bodyType", "school", "mbti", "zodiac", "interests", "about"];
  const preferenceKeys = ["seeking", "minAge", "maxAge", "preferredCity", "preferredHeightMin", "preferredHeightMax", "preferredBodyType", "preferredZodiac", "partnerNote"];
  return { version: 3, status: "conversation_preview", answeredTopics: view.step, totalTopics: conversationSteps.length,
    basics: Object.fromEntries(basicKeys.map(key => [key, known[key] ?? null])),
    preferences: Object.fromEntries(preferenceKeys.map(key => [key, known[key] ?? null])),
    depth: view.draft.depth, missingBasics };
}
