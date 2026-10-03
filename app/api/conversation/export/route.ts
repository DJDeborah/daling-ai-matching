import { getCurrentUser } from "@/lib/auth";
import { database, jsonError } from "@/lib/database";
import { loadConversation } from "@/lib/conversation";
import { draftMatchingDocument } from "@/lib/draft-matching";

export const runtime = "edge";
export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  return Response.json(draftMatchingDocument(await loadConversation(database(), user.userId)), { headers: { "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="daling-conversation.json"' } });
}
