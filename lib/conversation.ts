import { ownProfile } from "./database";
import { deepseekJson, deepseekText, releaseAiCall, reserveAiCall } from "./ai";
import { blankProfile, containsContact, matchingDocument, profileSchema, rowToInput, type DraftProfile, type ProfileInput } from "./profile";
import { z } from "zod";
import { conversationSteps, interviewSteps, basicsRequired, depthStart, parseValue, emptyValue, skipped, buildInterviewPrompt, buildChatPrompt, currentTopicAnswers, type Step, type StepKey } from "./interview";
import { parseDepth, depthKeys, type DepthKey } from "./depth";
export { conversationSteps } from "./interview";

export type ChatMessage = { role: "assistant" | "user"; content: string; topic?: StepKey; ai?: { source: "ai"; model: string; providerResponseId: string; requestId: string; elapsedMs: number } };
export type ConversationStatus = "collecting" | "review" | "complete" | "paused";
export type ConversationView = {
  protocolVersion: number;
  example: string | null;
  canSave: boolean;
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

const reviewQuestion = "请核对已提供的资料，再决定是否保存、是否进入匹配池。未回答的深度内容保持待了解。";
const completeMessage = "资料已保存。现在可以查看匹配报告；你也可以稍后独立编辑资料。";
const aiOutput = z.object({ decision: z.enum(["advance", "clarify", "skip"]), value: z.unknown() }).strict();

function initial(): ConversationView {
  return {
    protocolVersion:3, example:conversationSteps[0].example ?? null, canSave:false,
    turn: 0, step: 0, status: "collecting", draft: { ...blankProfile, depth: parseDepth(null) },
    messages: [{ role: "assistant", content: conversationSteps[0].question }],
    question: conversationSteps[0].question, totalSteps: conversationSteps.length,
    topic: conversationSteps[0].key, phase: "basics",
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
    const status: ConversationStatus = row.status === "review" || row.status === "complete" || row.status === "paused" ? row.status : "collecting";
    const protocolVersion = row.protocol_version >= 3 ? 3 : 2;
    const steps = interviewSteps({protocolVersion});
    const step = Math.max(0, Math.min(steps.length, row.step));
    const question = status === "collecting" || status === "paused" ? row.question_text || steps[step]?.question || reviewQuestion : status === "review" ? reviewQuestion : "";
    const key=steps[step]?.key;
    return { protocolVersion, example:steps[step]?.example ?? null, canSave:step >= basicsRequired({protocolVersion}), turn: row.turn, step, status, draft, messages: messages.length ? messages : [{role:"assistant",content:steps[0].question}], question, totalSteps: steps.length, topic: key ?? "review", phase: status === "collecting" ? step < depthStart({protocolVersion}) ? "basics" : "depth" : "review", revision: row.updated_at, inputLimit:key === "about" ? 400 : key === "partnerNote" ? 240 : 700 };
  } catch {
    // A damaged draft never grants publication; the user can reset the conversation.
    return initial();
  }
}

async function snapshot(db: D1Database, userId: string): Promise<{ row: ConversationRow; view: ConversationView }> {
  const first = initial();
  await db.prepare(`INSERT INTO conversations (user_id, turn, step, status, draft_json, messages_json, updated_at, protocol_version, question_text)
    SELECT ?, 0, 0, 'collecting', ?, ?, ?, 3, ? FROM users WHERE user_id = ?
    ON CONFLICT(user_id) DO NOTHING`)
    .bind(userId, JSON.stringify(first.draft), JSON.stringify(first.messages), first.revision, first.question, userId).run();
  const row = await db.prepare("SELECT * FROM conversations WHERE user_id = ?").bind(userId).first<ConversationRow>();
  if (!row) throw new ConversationConflict("账号已更新，请重新登录");
  return { row, view: readRow(row) };
}

export async function loadConversation(db: D1Database, userId: string): Promise<ConversationView> {
  return (await snapshot(db, userId)).view;
}

async function interpretAnswer(db: D1Database, userId: string, view: ConversationView, step: Step, message: string): Promise<{ update: Partial<DraftProfile> | null; assistant: ChatMessage }> {
  const isSkip = step.optional && skipped(message);
  const eventId = await reserveAiCall(db, userId);
  if (!eventId) throw new ConversationLimit("今天的 AI 对话次数已用完，请明天继续。你的进度已保存。");
  const messages = buildInterviewPrompt(view, message, isSkip);
  const signal = AbortSignal.timeout(30000);
  const requestId = crypto.randomUUID();
  let stage = "extract";
  try {
    let update: Partial<DraftProfile> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
    const raw = await deepseekJson(messages, 750, signal);
    const result = aiOutput.safeParse(raw);
    if (!result.success) throw new Error("invalid interview response");
    const answer = result.data;
    if (answer.decision !== "advance" && answer.value !== null) throw new Error("invalid interview response");
    if (isSkip || answer.decision === "skip") {
      if(!step.optional) throw new Error("cannot skip required topic");
      update = parseValue(step.key, emptyValue(step.key));
    }
    else if (answer.decision === "advance") {
      let value = answer.value;
      // The model confirms that this is an answer before the original wording is saved.
      if (step.key === "about" || step.key === "partnerNote") value = message;
      if (depthKeys.includes(step.key as DepthKey) && value && typeof value === "object" && !Array.isArray(value)) {
        value = { ...value, status: "answered", answer: [...currentTopicAnswers(view), message].join("\n\n") };
      }
      update = parseValue(step.key, value);
      if (!update) throw new Error("invalid extracted value");
    }
    break;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid interview response";
      const repairable = ["invalid interview response", "invalid extracted value", "cannot skip required topic", "Invalid AI JSON response"].includes(reason);
      if (attempt === 1 || !repairable || signal.aborted) throw error;
      messages.splice(messages.length - 1, 0, { role: "system", content: `上一次生成未通过服务器校验（${reason}）。重新理解同一条用户回答，只输出decision、value两个字段的完整JSON。严格使用当前主题字段契约，不跨主题、不生成聊天、不猜测内容。clarify/skip的value必须null。` });
    }
    }
    stage = "chat";
    const chatMessages = buildChatPrompt(view, message, mergeDraft(view.draft, update), update !== null);
    // The second call generates the entire visible reply. Neither an extraction
    // acknowledgment nor a local question is added to the provider's text.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await deepseekText(chatMessages, signal);
      // A quoted question or two parts of the same topic can contain several
      // question marks. Punctuation cannot reliably identify topic changes.
      const invalidReason = response.content.length > 800 ? "length" : containsContact(response.content) ? "contact" : /^\s*(?:\{|```)/.test(response.content) ? "structured" : null;
      if (invalidReason) {
        console.warn("interview chat rejected", JSON.stringify({ requestId, reason: invalidReason, characters: response.content.length }));
        if (attempt === 1) throw new Error("invalid chat response");
        chatMessages.splice(chatMessages.length - 1, 0, { role: "system", content: "请重新生成自然聊天原文：最多450字，不输出JSON、代码、联系方式或链接；只引导服务器指定主题，只问一个主要问题。" });
        continue;
      }
      const { content, ...metadata } = response;
      console.info("interview completed", JSON.stringify({ requestId, topic: step.key, target: interviewSteps(view)[view.step + (update ? 1 : 0)]?.key ?? "review", providerResponseId: metadata.providerResponseId, model: metadata.model, elapsedMs: metadata.elapsedMs }));
      return { update, assistant: { role: "assistant", content, ai: { source: "ai", requestId, ...metadata } } };
    }
    throw new Error("invalid chat response");
  } catch (error) {
    await releaseAiCall(db, eventId);
    const reason = error instanceof Error ? error.message : "unknown";
    const safeReason = /^(invalid |Invalid AI |Incomplete AI |Empty AI |AI provider returned \d{3}|cannot skip required topic)/.test(reason) ? reason : error instanceof Error ? error.name : "unknown";
    console.error("interview failed", JSON.stringify({ requestId, stage, reason: safeReason }));
    // Never guess deep preferences or silently replace the oriented dialogue with a form.
    throw new ConversationAiUnavailable("妲灵暂时没能完成这次回应。你的回答还在输入框里，请稍后重试。");
  }
}

function mergeDraft(draft: DraftProfile, update: Partial<DraftProfile> | null): DraftProfile {
  return update ? { ...draft, ...update, depth: update.depth ? { version: 1, topics: { ...draft.depth.topics, ...update.depth.topics } } : draft.depth } : draft;
}

function append(view: ConversationView, userMessage: string, assistant: ChatMessage, update: Partial<DraftProfile> | null): ConversationView {
  const steps = interviewSteps(view);
  const nextStep = update ? view.step + 1 : view.step;
  const status: ConversationStatus = nextStep >= steps.length ? "review" : "collecting";
  return {
    protocolVersion:view.protocolVersion, example:steps[nextStep]?.example ?? null, canSave:nextStep >= basicsRequired(view),
    turn: view.turn + 1, step: nextStep, status,
    draft: mergeDraft(view.draft, update),
    messages: [...view.messages, { role: "user" as const, content: userMessage, topic: steps[view.step].key }, assistant].slice(-80),
    question: assistant.content,
    totalSteps: steps.length,
    topic: steps[nextStep]?.key ?? "review", phase: status === "review" ? "review" : nextStep < depthStart(view) ? "basics" : "depth",
    revision: revision(), inputLimit: steps[nextStep]?.key === "about" ? 400 : steps[nextStep]?.key === "partnerNote" ? 240 : 700,
  };
}

export class ConversationConflict extends Error {}
export class ConversationLimit extends Error {}
export class ConversationValidation extends Error {}
export class ConversationAiUnavailable extends Error {}

export async function transitionConversation(db: D1Database, userId: string, turn: number, expectedRevision: string, action: "pause" | "resume" | "review"): Promise<ConversationView> {
  const { row, view } = await snapshot(db, userId);
  if (view.turn !== turn || row.updated_at !== expectedRevision) throw new ConversationConflict("对话已更新，请刷新后继续");
  if (action === "pause" && view.status !== "collecting" && view.status !== "review") throw new ConversationConflict("请先返回对话");
  if (action === "resume" && view.status !== "paused") throw new ConversationConflict("当前对话没有暂停");
  if (action === "review" && view.status !== "paused" && view.status !== "collecting") throw new ConversationConflict("请先返回对话");
  // Only these six required topics establish real matching credentials. Draft
  // previews never turn blankProfile defaults into confirmed personal data.
  if (action === "review" && !view.canSave) throw new ConversationValidation("先补充称呼、性别、年龄、城市和认识对象的基本偏好，再保存正式档案。现在仍可查看体验匹配。");
  const status: ConversationStatus = action === "pause" ? "paused" : action === "review" || view.step >= view.totalSteps ? "review" : "collecting";
  const next: ConversationView = { ...view, status, revision: revision(), phase: status === "collecting" ? view.step < depthStart(view) ? "basics" : "depth" : "review" };
  const write = await db.prepare("UPDATE conversations SET status = ?, turn = ?, updated_at = ? WHERE user_id = ? AND turn = ? AND updated_at = ?")
    .bind(status, next.turn, next.revision, userId, turn, expectedRevision).run();
  if (!write.meta.changes) throw new ConversationConflict("对话已更新，请刷新后继续");
  return next;
}

export async function answerConversation(db: D1Database, userId: string, expectedTurn: number, expectedRevision: string, message: string): Promise<ConversationView> {
  const { row, view } = await snapshot(db, userId);
  if (view.turn !== expectedTurn || row.updated_at !== expectedRevision || view.status !== "collecting") throw new ConversationConflict("对话已更新，请刷新后继续");
  if (message.length > view.inputLimit) throw new ConversationValidation(`这一项最多 ${view.inputLimit} 字，可以保留最重要的部分。`);
  if (view.turn >= 100) throw new ConversationLimit("这轮对话过长，请重置后重新开始");
  const step = interviewSteps(view)[view.step];
  const { update, assistant } = await interpretAnswer(db, userId, view, step, message);
  const response = append(view, message, assistant, update);
  const write = await db.prepare(`UPDATE conversations SET turn = ?, step = ?, status = ?, draft_json = ?, messages_json = ?, updated_at = ?, protocol_version = ?, question_text = ?
    WHERE user_id = ? AND turn = ? AND status = 'collecting' AND updated_at = ?`)
    .bind(response.turn, response.step, response.status, JSON.stringify(response.draft), JSON.stringify(response.messages), response.revision, response.protocolVersion, response.question, userId, expectedTurn, row.updated_at).run();
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
  if (!view.canSave) throw new ConversationValidation("请先确认基本资料，未回答的信息不能代为填写");
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
  const writes=await db.batch([db.prepare(`UPDATE conversations SET turn = 0, step = 0, status = 'collecting',
    draft_json = ?, messages_json = ?, updated_at = ?, protocol_version = 3, question_text = ? WHERE user_id = ? AND turn = ? AND updated_at = ?`)
    .bind(JSON.stringify(first.draft),JSON.stringify(first.messages),first.revision,first.question,userId,expectedTurn,expectedRevision),
    db.prepare("DELETE FROM draft_match_reports WHERE user_id = ? AND EXISTS (SELECT 1 FROM conversations WHERE user_id = ? AND updated_at = ?)").bind(userId,userId,first.revision)]);
  if (!writes[0]?.meta.changes) throw new ConversationConflict("对话已更新，请刷新后继续");
  return first;
}

export async function deepenConversation(db: D1Database, userId: string, expectedTurn: number, expectedRevision: string): Promise<ConversationView> {
  const { row, view } = await snapshot(db, userId);
  if (view.turn !== expectedTurn || row.updated_at !== expectedRevision || (view.status !== "complete" && view.status !== "review")) throw new ConversationConflict("对话已更新，请在完成当前对话后补充深度档案");
  const profile = await ownProfile(db, userId);
  const draft = view.status === "complete" && profile ? rowToInput(profile) : view.draft;
  const steps = interviewSteps(view);
  const step = view.step < steps.length ? view.step : depthStart(view);
  const topic = steps[step];
  const question = topic.question;
  const next: ConversationView = { ...view, draft, status: "collecting", step, turn: view.turn + 1, question, topic: topic.key, example:topic.example ?? null, phase: step < depthStart(view) ? "basics" : "depth", revision: revision(), inputLimit:700, messages: [{ role: "assistant", content: `刚才的资料已保留，我们接着慢慢聊。\n\n${question}` }] };
  const write = await db.prepare("UPDATE conversations SET status = 'collecting', step = ?, turn = ?, draft_json = ?, messages_json = ?, updated_at = ?, protocol_version = ?, question_text = ? WHERE user_id = ? AND turn = ? AND updated_at = ?")
    .bind(step, next.turn, JSON.stringify(next.draft), JSON.stringify(next.messages), next.revision, next.protocolVersion, question, userId, expectedTurn, row.updated_at).run();
  if (!write.meta.changes) throw new ConversationConflict("对话已更新，请刷新后继续");
  return next;
}
