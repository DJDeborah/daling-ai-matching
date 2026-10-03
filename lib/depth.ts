import { z } from "zod";

export const depthKeys = ["values", "conflict", "support", "rhythm", "future", "boundaries"] as const;
export type DepthKey = typeof depthKeys[number];
export const depthLabels: Record<DepthKey, string> = { values: "关系价值观", conflict: "分歧与修复", support: "情感支持", rhythm: "生活节奏", future: "未来方向", boundaries: "相处边界" };
export const valueOptions = ["honesty", "growth", "stability", "independence", "equality", "exploration", "family"] as const;
export const conflictOptions = ["talk_now", "cooldown_then_talk", "write_then_talk"] as const;
export const supportOptions = ["listening", "reassurance", "companionship", "practical_help", "space"] as const;
export const contactOptions = ["daily", "several_per_week", "flexible"] as const;
export const timeOptions = ["frequent", "balanced", "independent"] as const;
export const goalOptions = ["long_term", "exploring", "companionship"] as const;
export const marriageOptions = ["want", "not_want", "open"] as const;
export const childOptions = ["want", "not_want", "open"] as const;
export const paceOptions = ["slow", "balanced", "quick"] as const;
export const moneyOptions = ["separate", "shared", "flexible"] as const;

// A topic can take several chat turns. Each message is still limited to 700
// characters; preserve all same-topic user messages retained in the transcript.
const metadata = { status: z.enum(["answered", "skipped"]), summary: z.string().trim().max(200), answer: z.string().trim().max(30_000) };
const list = <T extends readonly [string, ...string[]]>(options: T) => z.array(z.enum(options)).max(8).refine(v => new Set(v).size === v.length);
export const depthSchemas = {
  values: z.object({ ...metadata, priorities: list(valueOptions) }).strict(),
  conflict: z.object({ ...metadata, approach: z.enum(conflictOptions).nullable(), accepts: list(conflictOptions), repairNeeds: list(supportOptions) }).strict(),
  support: z.object({ ...metadata, needs: list(supportOptions), offers: list(supportOptions) }).strict(),
  rhythm: z.object({ ...metadata, contact: z.enum(contactOptions).nullable(), acceptsContact: list(contactOptions), time: z.enum(timeOptions).nullable(), acceptsTime: list(timeOptions) }).strict(),
  future: z.object({ ...metadata, goal: z.enum(goalOptions).nullable(), acceptsGoals: list(goalOptions), marriage: z.enum(marriageOptions).nullable(), children: z.enum(childOptions).nullable(), relocation: z.enum(["stay", "open", "discuss"]).nullable() }).strict(),
  boundaries: z.object({ ...metadata, privacy: z.enum(["independent", "shared", "discuss"]).nullable(), acceptsPrivacy: list(["independent", "shared", "discuss"]), pace: z.enum(paceOptions).nullable(), acceptsPace: list(paceOptions), money: z.enum(moneyOptions).nullable(), acceptsMoney: list(moneyOptions) }).strict(),
};
export const depthSchema = z.object({ version: z.literal(1), topics: z.object({
  values: depthSchemas.values.optional(), conflict: depthSchemas.conflict.optional(), support: depthSchemas.support.optional(),
  rhythm: depthSchemas.rhythm.optional(), future: depthSchemas.future.optional(), boundaries: depthSchemas.boundaries.optional(),
}).strict() }).strict();
export type DepthProfile = z.infer<typeof depthSchema>;
export const blankDepth = (): DepthProfile => ({ version: 1, topics: {} });

export function parseDepth(value: unknown): DepthProfile {
  const parsed = depthSchema.safeParse(value);
  return parsed.success ? parsed.data : blankDepth();
}

export function readMatchingDepth(json: string | undefined): DepthProfile {
  try { return parseDepth(JSON.parse(json ?? "{}").depth); } catch { return blankDepth(); }
}

export function skippedDepth(key: DepthKey): unknown {
  const base = { status: "skipped", answer: "", summary: "暂不填写" };
  if (key === "values") return { ...base, priorities: [] };
  if (key === "conflict") return { ...base, approach: null, accepts: [], repairNeeds: [] };
  if (key === "support") return { ...base, needs: [], offers: [] };
  if (key === "rhythm") return { ...base, contact: null, acceptsContact: [], time: null, acceptsTime: [] };
  if (key === "future") return { ...base, goal: null, acceptsGoals: [], marriage: null, children: null, relocation: null };
  return { ...base, privacy: null, acceptsPrivacy: [], pace: null, acceptsPace: [], money: null, acceptsMoney: [] };
}

export function depthAnswered(depth: DepthProfile): number {
  return depthKeys.filter(key => depth.topics[key]?.status === "answered").length;
}
