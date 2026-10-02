import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import {
  answerConversation, completeConversation, completionSchema, ConversationConflict,
  ConversationLimit, ConversationValidation, loadConversation, resetConversation,
  ConversationAiUnavailable, deepenConversation,
} from "@/lib/conversation";
import { containsContact } from "@/lib/profile";
import { z } from "zod";

export const runtime = "edge";

const revisionSchema={turn:z.number().int().min(0),revision:z.string().min(1).max(100)};
const answerSchema = z.object({ message: z.string().trim().min(1).max(700), ...revisionSchema }).strict();

async function body(request: Request, maxLength: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new InputError("需要 JSON 请求", 415);
  const raw = await request.text();
  if (raw.length > maxLength) throw new InputError("内容过长", 413);
  try { return JSON.parse(raw); } catch { throw new InputError("请求内容无效", 400); }
}

class InputError extends Error { constructor(message: string, public status = 400) { super(message); } }

function failure(error: unknown): Response {
  if (error instanceof InputError) return jsonError(error.message, error.status);
  if (error instanceof ConversationConflict) return jsonError(error.message, 409);
  if (error instanceof ConversationLimit) return jsonError(error.message, 429);
  if (error instanceof ConversationValidation) return jsonError(error.message, 400);
  if (error instanceof ConversationAiUnavailable) return jsonError(error.message, 503);
  console.error("conversation request failed", error);
  return jsonError("对话暂时不可用，请稍后重试", 503);
}

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先注册或登录", 401);
  try {
    return Response.json(await loadConversation(database(), user.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先注册或登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  try {
    const parsed = answerSchema.safeParse(await body(request, 2500));
    if (!parsed.success) return jsonError("请填写当前问题的回答，最多 700 字", 400);
    // No contact details enter the transcript or the AI provider.
    if (containsContact(parsed.data.message)) return jsonError("对话中不要填写联系方式；完成资料后可单独设置分享授权", 400);
    const result = await answerConversation(database(), user.userId, parsed.data.turn, parsed.data.revision, parsed.data.message);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先注册或登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  try {
    const parsed = z.object(revisionSchema).strict().safeParse(await body(request, 250));
    if (!parsed.success) return jsonError("请求内容无效", 400);
    return Response.json(await deepenConversation(database(), user.userId, parsed.data.turn, parsed.data.revision), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先注册或登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  try {
    const parsed = completionSchema.safeParse(await body(request, 1600));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "请检查确认内容", 400);
    const result = await completeConversation(database(), user.userId, parsed.data);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先注册或登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  try {
    const parsed=z.object(revisionSchema).strict().safeParse(await body(request,250));
    if(!parsed.success) return jsonError("请求内容无效，请刷新后重试",400);
    return Response.json(await resetConversation(database(), user.userId, parsed.data.turn, parsed.data.revision), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
