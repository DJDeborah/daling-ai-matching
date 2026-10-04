import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import { ConversationConflict } from "@/lib/conversation";
import { getMatchingReport, analyzeMatchingReport } from "@/lib/report-service";
export const runtime = "edge";
const response = (result: unknown) => Response.json(result, { headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  try { return response(await getMatchingReport(database(), user.userId)); }
  catch { return jsonError("暂时无法加载匹配报告，请点击重新加载", 503); }
}
export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  let input: { consent: true; refresh?: boolean; revision?: string };
  try {
    const raw = await request.text();
    if (raw.length > 400) return jsonError("请求内容过长", 413);
    const parsed = z.object({ consent: z.literal(true), refresh: z.boolean().optional(), revision: z.string().max(100).optional() }).strict().safeParse(JSON.parse(raw));
    if (!parsed.success) return jsonError("请先确认将精简匹配资料发给 AI 分析", 400);
    input = parsed.data;
  } catch { return jsonError("请求内容无效", 400); }
  try { return response(await analyzeMatchingReport(database(), user.userId, input)); }
  catch (error) {
    if (error instanceof ConversationConflict) return jsonError(error.message, 409);
    return jsonError("暂时无法加载匹配报告", 503);
  }
}
