import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import { ConversationConflict, ConversationValidation, transitionConversation } from "@/lib/conversation";

export const runtime = "edge";
const schema = z.object({ action: z.enum(["pause", "resume", "review"]), turn: z.number().int().min(0), revision: z.string().min(1).max(100) }).strict();

export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  try {
    const raw = await request.text();
    if (raw.length > 300) return jsonError("请求内容过长", 413);
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return jsonError("请求内容无效", 400);
    return Response.json(await transitionConversation(database(), user.userId, parsed.data.turn, parsed.data.revision, parsed.data.action), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConversationConflict) return jsonError(error.message, 409);
    if (error instanceof ConversationValidation) return jsonError(error.message, 400);
    return jsonError("暂时无法切换，请稍后重试", 503);
  }
}
