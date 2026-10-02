import { z } from "zod";
import { blankDepth, depthSchema, readMatchingDepth } from "./depth";

export const genderOptions = ["man", "woman", "nonbinary"] as const;
export type Gender = (typeof genderOptions)[number];
export const genderLabels: Record<Gender, string> = { man: "男", woman: "女", nonbinary: "非二元" };

const optionalText = (max: number) => z.string().trim().max(max);
const optionalHeight = z.number().int().min(120).max(230).nullable();
const obviousContact = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\s-]?){9,}|(?:微信号|加我微信|telegram\s*[:：]|wx\s*[:：]))/i;
export function containsContact(value: string): boolean { return obviousContact.test(value); }

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(24),
  gender: z.enum(genderOptions),
  seeking: z.enum([...genderOptions, "any"] as const),
  age: z.number().int().min(18).max(80),
  minAge: z.number().int().min(18).max(80),
  maxAge: z.number().int().min(18).max(80),
  city: z.string().trim().min(2).max(40),
  preferredCity: optionalText(40),
  heightCm: optionalHeight,
  preferredHeightMin: optionalHeight,
  preferredHeightMax: optionalHeight,
  bodyType: optionalText(20),
  preferredBodyType: optionalText(20),
  school: optionalText(80),
  mbti: z.union([z.literal(""), z.string().regex(/^[IE][NS][FT][JP]$/)]),
  zodiac: optionalText(12),
  preferredZodiac: optionalText(12),
  interests: z.array(z.string().trim().min(1).max(20)).max(8),
  about: optionalText(400),
  partnerNote: optionalText(240),
  depth: depthSchema.default(blankDepth),
  contactKind: z.enum(["wechat", "telegram", "email", "other"]),
  contactValue: optionalText(100),
  contactShare: z.boolean(),
  visible: z.boolean(),
  adultConfirmed: z.literal(true),
  poolConsent: z.literal(true),
}).superRefine((value, ctx) => {
  if (value.minAge > value.maxAge) ctx.addIssue({ code: "custom", path: ["maxAge"], message: "年龄范围不正确" });
  if (value.preferredHeightMin && value.preferredHeightMax && value.preferredHeightMin > value.preferredHeightMax) {
    ctx.addIssue({ code: "custom", path: ["preferredHeightMax"], message: "身高范围不正确" });
  }
  if (value.contactShare && !value.contactValue) ctx.addIssue({ code: "custom", path: ["contactValue"], message: "填写联系方式后才能授权分享" });
  if (new Set(value.interests.map(x => x.toLocaleLowerCase())).size !== value.interests.length) {
    ctx.addIssue({ code: "custom", path: ["interests"], message: "兴趣标签不能重复" });
  }
  for (const field of ["name", "city", "preferredCity", "about", "partnerNote", "school"] as const) {
    if (obviousContact.test(value[field])) ctx.addIssue({ code: "custom", path: [field], message: "公开文字中不要填写联系方式，请在最后一步单独填写" });
  }
  if (value.interests.some(text => obviousContact.test(text))) {
    ctx.addIssue({ code: "custom", path: ["interests"], message: "兴趣标签中不要填写联系方式" });
  }
  if (obviousContact.test(JSON.stringify(value.depth))) ctx.addIssue({ code: "custom", path: ["depth"], message: "深度档案中不要填写联系方式" });
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type DraftProfile = Omit<ProfileInput, "adultConfirmed" | "poolConsent"> & { adultConfirmed: boolean; poolConsent: boolean };

export const blankProfile: DraftProfile = {
  name: "", gender: "woman", seeking: "any", age: 24, minAge: 18, maxAge: 40,
  city: "", preferredCity: "", heightCm: null, preferredHeightMin: null,
  preferredHeightMax: null, bodyType: "", preferredBodyType: "", school: "",
  mbti: "", zodiac: "", preferredZodiac: "", interests: [], about: "",
  partnerNote: "", contactKind: "wechat", contactValue: "", contactShare: false,
  depth: blankDepth(),
  visible: false, adultConfirmed: false, poolConsent: false,
};

export type ProfileRow = {
  profile_id: string; user_id: string; name: string; gender: Gender;
  seeking: Gender | "any"; age: number; min_age: number; max_age: number;
  city: string; preferred_city: string; height_cm: number | null;
  preferred_height_min: number | null; preferred_height_max: number | null;
  body_type: string; preferred_body_type: string; school: string; mbti: string;
  zodiac: string; preferred_zodiac: string; interests_json: string; about: string;
  partner_note: string; contact_kind: string; contact_value: string;
  contact_share: number; visible: number; adult_confirmed_at: string;
  pool_consented_at: string | null; created_at: string; updated_at: string;
  matching_json?: string;
};

export function rowToInput(row: ProfileRow): ProfileInput {
  let interests: string[] = [];
  try { interests = JSON.parse(row.interests_json); } catch { /* corrupt legacy row */ }
  return {
    name: row.name, gender: row.gender, seeking: row.seeking, age: row.age,
    minAge: row.min_age, maxAge: row.max_age, city: row.city,
    preferredCity: row.preferred_city, heightCm: row.height_cm,
    preferredHeightMin: row.preferred_height_min, preferredHeightMax: row.preferred_height_max,
    bodyType: row.body_type, preferredBodyType: row.preferred_body_type,
    school: row.school, mbti: row.mbti, zodiac: row.zodiac,
    preferredZodiac: row.preferred_zodiac, interests, about: row.about,
    partnerNote: row.partner_note, contactKind: row.contact_kind as ProfileInput["contactKind"],
    depth: readMatchingDepth(row.matching_json),
    contactValue: row.contact_value, contactShare: row.contact_share === 1,
    visible: row.visible === 1, adultConfirmed: true, poolConsent: true,
  };
}

export function matchingDocument(profile: DraftProfile | ProfileInput) {
  return {
    version: 2,
    basics: { name: profile.name, gender: profile.gender, age: profile.age, city: profile.city, heightCm: profile.heightCm, bodyType: profile.bodyType, school: profile.school, mbti: profile.mbti, zodiac: profile.zodiac, interests: profile.interests, about: profile.about },
    preferences: { seeking: profile.seeking, minAge: profile.minAge, maxAge: profile.maxAge, preferredCity: profile.preferredCity, preferredHeightMin: profile.preferredHeightMin, preferredHeightMax: profile.preferredHeightMax, preferredBodyType: profile.preferredBodyType, preferredZodiac: profile.preferredZodiac, partnerNote: profile.partnerNote },
    depth: profile.depth,
  };
}
