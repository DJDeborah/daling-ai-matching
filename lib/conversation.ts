import { ownProfile } from "./database";
import { deepseekJson, releaseAiCall, reserveAiCall } from "./ai";
import { blankProfile, containsContact, matchingDocument, profileSchema, rowToInput, type DraftProfile, type ProfileInput } from "./profile";
import { z } from "zod";
import { conversationSteps, parseValue, emptyValue, skipped, buildInterviewPrompt, type Step } from "./interview";
import { parseDepth, depthKeys, type DepthKey } from "./depth";
export { conversationSteps } from "./interview";

export type ChatMessage = { role: "assistant" | "user"; content: string };
export type ConversationStatus = "collecting" | "review" | "complete";
export type ConversationView = {
  turn: number;
  step: number;
  status: ConversationStatus;
  draft: DraftProfile;
  messages: ChatMessage[];
  question: string;
  totalSteps: number;
  topic: string;
  phase: "basics" | "depth" | "review";
  revision: string;
  inputLimit: number;
};

type ConversationRow = {
  user_id: string;
  turn: number;
  step: number;
  status: string;
  draft_json: string;
  messages_json: string;
  updated_at: string;
  protocol_version: number;
  question_text: string;
};

const reviewQuestion = "已经聊完啦。请核对下方资料，再决定是否保存、是否进入匹配池。联系方式只在双方心动且双方都授权时显示。";
const completeMessage = "资料已保存。现在可以查看匹配报告；你也可以稍后独立编辑资料。";
const aiOutput = z.object({ decision: z.enum(["advance", "clarify", "skip"]), value: z.unknown(), reply: z.string().trim().min(2).max(180), questionKey: z.string(), question: z.string().trim().min(4).max(220) });

function initial(): ConversationView {
  return {
    turn: 0, step: 0, status: "collecting", draft: { ...blankProfile, depth: parseDepth(null) },
    messages: [{ role: "assistant", content: conversationSteps[0].question }],
    question: conversationSteps[0].question, totalSteps: conversationSteps.length,
    topic: "name", phase: "basics",
    revision: revision(), inputLimit: 700,
  };
}

function revision(): string {
  // A unique value prevents a slow request from committing after a reset,
  // even when both writes happen in the same millisecond.
  return `${new Date().toISOString()}|${crypto.randomUUID()}`;
}

function readRow(row: ConversationRow): ConversationView {
  try {
    const draft = { ...blankProfile, ...JSON.parse(row.draft_json) } as DraftProfile;
    draft.depth = parseDepth(draft.depth);
    const rawMessages: unknown = JSON.parse(row.messages_json);
    const messages: ChatMessage[] = Array.isArray(rawMessages)
      ? rawMessages.filter((item): item is ChatMessage => Boolean(item && typeof item === "object" && (item.role === "assistant" || item.role === "user") && typeof item.content === "string")).slice(-80)
      : [];
    const status: ConversationStatus = row.status === "review" || row.status === "complete" ? row.status : "collecting";
    const step = Math.max(0, Math.min(conversationSteps.length, row.step));
    const question = status === "collecting" ? row.question_text || conversationSteps[step]?.question || reviewQuestion : status === "review" ? reviewQuestion : "";
    const key=conversationSteps[step]?.key;
    return { turn: row.turn, step, status, draft, messages: messages.length ? messages : initial().messages, question, totalSteps: conversationSteps.length, topic: key ?? "review", phase: status === "collecting" ? step < 13 ? "basics" : "depth" : "review", revision: row.updated_at, inputLimit:key === "about" ? 400 : key === "partnerNote" ? 240 : 700 };
  } catch {
    // A damaged draft never grants publication; the user can reset the conversation.
    return initial();
  }
}

async function snapshot(db: D1Database, userId: string): Promise<{ row: ConversationRow; view: ConversationView }> {
  const first = initial();
  await db.prepare(`INSERT INTO conversations (user_id, turn, step, status, draft_json, messages_json, updated_at, protocol_version, question_text)
    SELECT ?, 0, 0, 'collecting', ?, ?, ?, 2, ? FROM users WHERE user_id = ?
    ON CONFLICT(user_id) DO NOTHING`)
    .bind(userId, JSON.stringify(first.draft), JSON.stringify(first.messages), first.revision, first.question, userId).run();
  const row = await db.prepare("SELECT * FROM conversations WHERE user_id = ?").bind(userId).first<ConversationRow>();
  if (!row) throw new ConversationConflict("账号已更新，请重新登录");
  return { row, view: readRow(row) };
}

export async function loadConversation(db: D1Database, userId: string): Promise<ConversationView> {
  return (await snapshot(db, userId)).view;
}

async function interpretAnswer(db: D1Database, userId: string, view: ConversationView, step: Step, message: string): Promise<{ update: Partial<DraftProfile> | null; reply: string; question: string }> {
  const isSkip = step.optional && skipped(message);
  const eventId = await reserveAiCall(db, userId);
  if (!eventId) throw new ConversationLimit("今天的 AI 对话次数已用完，请明天继续。你的进度已保存。");
  const messages = buildInterviewPrompt(view, message, isSkip);
  const signal = AbortSignal.timeout(20000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
    const raw = await deepseekJson(messages, 950, signal);
    const result = aiOutput.safeParse(raw);
    if (!result.success) throw new Error("invalid interview response");
    const answer = result.data;
    let update: Partial<DraftProfile> | null = null;
    if (isSkip || answer.decision === "skip") {
      if(!step.optional) throw new Error("cannot skip required topic");
      update = parseValue(step.key, emptyValue(step.key));
    }
    else if (answer.decision === "advance") {
      let value = answer.value;
      // The model confirms that this is an answer before the original wording is saved.
      if (step.key === "about" || step.key === "partnerNote") value = message;
      if (depthKeys.includes(step.key as DepthKey) && value && typeof value === "object" && !Array.isArray(value)) value = { ...value, status: "answered", answer: message };
      update = parseValue(step.key, value);
      if (!update) throw new Error("invalid extracted value");
    }
    const expectedKey = update ? (view.step + 1 < conversationSteps.length ? conversationSteps[view.step + 1].key : "review") : step.key;
    if (answer.questionKey !== expectedKey || containsContact(answer.reply) || containsContact(answer.question) || (answer.question.match(/[?？]/g)?.length ?? 0) > 1) throw new Error("invalid interview question");
    return { update, reply: answer.reply, question: expectedKey === "review" ? reviewQuestion : answer.question };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid interview response";
      const repairable = ["invalid interview response", "invalid extracted value", "invalid interview question", "cannot skip required topic"].includes(reason);
      if (attempt === 1 || !repairable || signal.aborted) throw error;
      messages.splice(messages.length - 1, 0, { role: "system", content: `上一次生成未通过服务器校验（${reason}）。请重新理解同一条用户回答并输出完整JSON。严格使用当前主题字段契约，不要跨主题填值；advance或skip时questionKey=${conversationSteps[view.step + 1]?.key ?? "review"}，clarify时questionKey=${step.key}。reply不提问，question只提一个主要问题。不要编造或猜测未提供的内容。` });
    }
    }
    throw new Error("invalid interview response");
  } catch (error) {
    await releaseAiCall(db, eventId);
    const reason = error instanceof Error ? error.message : "unknown";
    const safeReason = /^(invalid |Invalid AI |Incomplete AI |Empty AI |AI provider returned \d{3}|cannot skip required topic)/.test(reason) ? reason : error instanceof Error ? error.name : "unknown";
    console.error("interview failed", safeReason);
    // Never guess deep preferences or silently replace the oriented dialogue with a form.
    throw new ConversationAiUnavailable("妲灵暂时没能完成这次回应。你的回答还在输入框里，请稍后重试。");
  }
}

function append(view: ConversationView, userMessage: string, assistantMessage: string, question: string, update: Partial<DraftProfile> | null): ConversationView {
  const nextStep = update ? view.step + 1 : view.step;
  const status: ConversationStatus = nextStep >= conversationSteps.length ? "review" : "collecting";
  return {
    turn: view.turn + 1, step: nextStep, status,
    draft: update ? { ...view.draft, ...update, depth: update.depth ? { version: 1, topics: { ...view.draft.depth.topics, ...update.depth.topics } } : view.draft.depth } : view.draft,
    messages: [...view.messages, { role: "user" as const, content: userMessage }, { role: "assistant" as const, content: assistantMessage }].slice(-80),
    question,
    totalSteps: conversationSteps.length,
    topic: conversationSteps[nextStep]?.key ?? "review", phase: status === "review" ? "review" : nextStep < 13 ? "basics" : "depth",
    revision: revision(), inputLimit: conversationSteps[nextStep]?.key === "about" ? 400 : conversationSteps[nextStep]?.key === "partnerNote" ? 240 : 700,
  };
}

export class ConversationConflict extends Error {}
export class ConversationLimit extends Error {}
export class ConversationValidation extends Error {}
export class ConversationAiUnavailable extends Error {}

export async function answerConversation(db: D1Database, userId: string, expectedTurn: number, expectedRevision: string, message: string): Promise<ConversationView> {
  const { row, view } = await snapshot(db, userId);
  if (view.turn !== expectedTurn || row.updated_at !== expectedRevision || view.status !== "collecting") throw new ConversationConflict("对话已更新，请刷新后继续");
  if (message.length > view.inputLimit) throw new ConversationValidation(`这一项最多 ${view.inputLimit} 字，可以保留最重要的部分。`);
  if (view.turn >= 100) throw new ConversationLimit("这轮对话过长，请重置后重新开始");
  const step = conversationSteps[view.step];
  const { update, reply, question } = await interpretAnswer(db, userId, view, step, message);
  const response = append(view, message, `${reply}\n\n${question}`, question, update);
  const write = await db.prepare(`UPDATE conversations SET turn = ?, step = ?, status = ?, draft_json = ?, messages_json = ?, updated_at = ?, protocol_version = 2, question_text = ?
    WHERE user_id = ? AND turn = ? AND status = 'collecting' AND updated_at = ?`)
    .bind(response.turn, response.step, response.status, JSON.stringify(response.draft), JSON.stringify(response.messages), response.revision, response.question, userId, expectedTurn, row.updated_at).run();
  if (!write.meta.changes) throw new ConversationConflict("对话已更新，请刷新后继续");
  return response;
}

const profileColumns = [
  "profile_id", "user_id", "name", "gender", "seeking", "age", "min_age", "max_age",
  "city", "preferred_city", "height_cm", "preferred_height_min", "preferred_height_max",
  "body_type", "preferred_body_type", "school", "mbti", "zodiac", "preferred_zodiac",
  "interests_json", "about", "partner_note", "contact_kind", "contact_value",
  "contact_share", "visible", "adult_confirmed_at", "pool_consented_at", "created_at", "updated_at",
  "matching_json",
] as const;

export const completionSchema = z.object({
  adultConfirmed: z.boolean(), poolConsent: z.boolean(), visible: z.boolean(),
  contactKind: z.enum(["wechat", "telegram", "email", "other"]),
  contactValue: z.string().trim().max(100), contactShare: z.boolean(),
  turn: z.number().int().min(0), revision: z.string().min(1).max(100),
}).strict();
export type CompletionInput = z.infer<typeof completionSchema>;

export async function completeConversation(db: D1Database, userId: string, input: CompletionInput): Promise<ConversationView> {
  const { row, view } = await snapshot(db, userId);
  if (view.turn !== input.turn || row.updated_at !== input.revision) throw new ConversationConflict("对话已更新，请刷新后核对当前档案再保存");
  if (view.status !== "review") throw new ConversationConflict("请先完成对话并核对资料");
  const parsed = profileSchema.safeParse({ ...view.draft, ...input });
  if (!parsed.success) throw new ConversationValidation(parsed.error.issues[0]?.message ?? "请检查资料和同意选项");
  const profile: ProfileInput = parsed.data;
  const current = await ownProfile(db, userId);
  const now = new Date().toISOString();
  const values = [
    current?.profile_id ?? crypto.randomUUID(), userId, profile.name, profile.gender, profile.seeking,
    profile.age, profile.minAge, profile.maxAge, profile.city, profile.preferredCity,
    profile.heightCm, profile.preferredHeightMin, profile.preferredHeightMax, profile.bodyType,
    profile.preferredBodyType, profile.school, profile.mbti, profile.zodiac, profile.preferredZodiac,
    JSON.stringify(profile.interests), profile.about, profile.partnerNote, profile.contactKind,
    profile.contactValue, Number(profile.contactShare), Number(profile.visible),
    current?.adult_confirmed_at ?? now, now, current?.created_at ?? now, now,
    JSON.stringify(matchingDocument(profile)),
  ];
  const mutable = profileColumns.slice(2).filter(c => c !== "adult_confirmed_at" && c !== "created_at");
  // D1 batch is one transaction. Every mutation in this batch checks the
  // exact review revision. A concurrent PATCH or reset changes that revision,
  // causing this entire stale attempt to write zero profile/like rows.
  const guard = "EXISTS (SELECT 1 FROM conversations WHERE user_id = ? AND status = 'review' AND turn = ? AND updated_at = ?)";
  const save = db.prepare(`INSERT INTO profiles (${profileColumns.join(", ")})
    SELECT ${profileColumns.map(() => "?").join(", ")} WHERE ${guard}
    ON CONFLICT(user_id) DO UPDATE SET ${mutable.map(c => `${c} = excluded.${c}`).join(", ")}`)
    .bind(...values, userId, view.turn, row.updated_at);
  const finished: ConversationView = {
    ...view, status: "complete", draft: profile, question: "", revision: revision(),
    messages: [...view.messages, { role: "assistant" as const, content: completeMessage }].slice(-80),
  };
  const mark = db.prepare("UPDATE conversations SET status = 'complete', draft_json = ?, messages_json = ?, updated_at = ?, question_text = '' WHERE user_id = ? AND status = 'review' AND turn = ? AND updated_at = ?")
    .bind(JSON.stringify(profile), JSON.stringify(finished.messages), finished.revision, userId, view.turn, row.updated_at);
  const statements = [save];
  if (!profile.visible && current) statements.push(db.prepare(`DELETE FROM likes WHERE (from_profile_id = ? OR to_profile_id = ?) AND ${guard}`)
    .bind(current.profile_id, current.profile_id, userId, view.turn, row.updated_at));
  statements.push(db.prepare(`DELETE FROM match_reports WHERE user_id = ? AND ${guard}`)
    .bind(userId, userId, view.turn, row.updated_at));
  statements.push(mark);
  const results = await db.batch(statements);
  if (!results[0]?.meta.changes || !results.at(-1)?.meta.changes) throw new ConversationConflict("对话已更新，请刷新后继续");
  return finished;
}

export async function resetConversation(db: D1Database, userId: string, expectedTurn: number, expectedRevision: string): Promise<ConversationView> {
  const {row,view}=await snapshot(db,userId);
  if (view.turn !== expectedTurn || row.updated_at !== expectedRevision) throw new ConversationConflict("对话已更新，请刷新后继续");
  const first = initial();
  const write=await db.prepare(`UPDATE conversations SET turn = 0, step = 0, status = 'collecting',
    draft_json = ?, messages_json = ?, updated_at = ?, protocol_version = 2, question_text = ? WHERE user_id = ? AND turn = ? AND updated_at = ?`)
    .bind(JSON.stringify(first.draft),JSON.stringify(first.messages),first.revision,first.question,userId,expectedTurn,expectedRevision).run();
  if (!write.meta.changes) throw new ConversationConflict("对话已更新，请刷新后继续");
  return first;
}

export async function deepenConversation(db: D1Database, userId: string, expectedTurn: number, expectedRevision: string): Promise<ConversationView> {
  const { row, view } = await snapshot(db, userId);
  if (view.turn !== expectedTurn || row.updated_at !== expectedRevision || (view.status !== "complete" && view.status !== "review")) throw new ConversationConflict("对话已更新，请在完成当前对话后补充深度档案");
  const profile = await ownProfile(db, userId);
  const draft = view.status === "complete" && profile ? rowToInput(profile) : view.draft;
  const question = conversationSteps[13].question;
  const next: ConversationView = { ...view, draft, status: "collecting", step: 13, turn: view.turn + 1, question, topic: "values", phase: "depth", revision: revision(), inputLimit: 700, messages: [{ role: "assistant", content: `基础资料已保留，我们接着聊深入一点的部分。\n\n${question}` }] };
  const write = await db.prepare("UPDATE conversations SET status = 'collecting', step = 13, turn = ?, draft_json = ?, messages_json = ?, updated_at = ?, protocol_version = 2, question_text = ? WHERE user_id = ? AND turn = ? AND updated_at = ?")
    .bind(next.turn, JSON.stringify(next.draft), JSON.stringify(next.messages), next.revision, question, userId, expectedTurn, row.updated_at).run();
  if (!write.meta.changes) throw new ConversationConflict("对话已更新，请刷新后继续");
  return next;
}
