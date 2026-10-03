import type { DraftProfile, ProfileRow } from "./profile";

const cityKey = (value: string) => value.trim().toLocaleLowerCase();
const genderName: Record<string,string> = { man:"男性",woman:"女性",nonbinary:"非二元性别",any:"不限性别" };

// Used only to describe distances to experimental profiles. Real matches still
// require the existing mutual eligibility and consent checks.
export function compareConstraints(self: DraftProfile, other: ProfileRow, known: Set<keyof DraftProfile>) {
  const unmetConditions: string[] = [], unknownConditions: string[] = [];
  let priorityPenalty = 0;
  const miss = (message: string, priority: number) => { unmetConditions.push(message); priorityPenalty += priority; };
  if (known.has("seeking") && self.seeking !== "any" && self.seeking !== other.gender) miss(`对方是${genderName[other.gender]}，与你期望的${genderName[self.seeking]}不同`,80);
  if (known.has("minAge") && (other.age < self.minAge || other.age > self.maxAge)) miss(`对方 ${other.age} 岁，超出你期望的 ${self.minAge}–${self.maxAge} 岁`,40);
  if (known.has("preferredCity") && self.preferredCity && cityKey(self.preferredCity) !== cityKey(other.city)) miss(`对方在${other.city}，与你限定的${self.preferredCity}不同`,20);
  if (known.has("preferredHeightMin") && self.preferredHeightMin || known.has("preferredHeightMax") && self.preferredHeightMax) {
    if (other.height_cm === null) unknownConditions.push("对方身高尚未提供，无法确认你的身高条件");
    else if (known.has("preferredHeightMin") && self.preferredHeightMin && other.height_cm < self.preferredHeightMin || known.has("preferredHeightMax") && self.preferredHeightMax && other.height_cm > self.preferredHeightMax) miss(`对方身高 ${other.height_cm} 厘米，不在你设定的身高范围`,10);
  }
  if (other.seeking !== "any") {
    if (!known.has("gender")) unknownConditions.push("你的性别尚未确认，无法比较对方的性别偏好");
    else if (other.seeking !== self.gender) miss(`对方希望认识${genderName[other.seeking]}，与你的性别不符`,80);
  }
  if (!known.has("age")) unknownConditions.push("你的年龄尚未确认，无法比较对方的年龄条件");
  else if (self.age < other.min_age || self.age > other.max_age) miss(`你的年龄不在对方期望的 ${other.min_age}–${other.max_age} 岁范围内`,40);
  if (other.preferred_city) {
    if (!known.has("city")) unknownConditions.push("你的城市尚未确认，无法比较对方的城市条件");
    else if (cityKey(other.preferred_city) !== cityKey(self.city)) miss(`对方希望认识住在${other.preferred_city}的人，与你的现居城市不同`,20);
  }
  if (other.preferred_height_min || other.preferred_height_max) {
    if (!known.has("heightCm") || self.heightCm === null) unknownConditions.push("你的身高尚未提供，无法确认对方的身高条件");
    else if (other.preferred_height_min && self.heightCm < other.preferred_height_min || other.preferred_height_max && self.heightCm > other.preferred_height_max) miss("你的身高不在对方设定的范围内",10);
  }
  return { unmetConditions, unknownConditions, priorityPenalty };
}
