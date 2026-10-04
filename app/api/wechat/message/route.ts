import { z } from "zod";
import { database, jsonError } from "@/lib/database";
import { constantEqual, wechatConfig } from "@/lib/wechat-config";
import { BridgeBusy, BridgeConflict, processWechatMessage } from "@/lib/wechat-bridge";
export const runtime = "edge";
const input = z.object({
  corpId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), openKfId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  externalUserId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), msgId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(2000), sendTime: z.number().int().positive(),
}).strict();
export async function POST(request: Request) {
  const config = wechatConfig();
  if (!config) return jsonError("微信入口尚未开通", 503);
  if (!constantEqual(request.headers.get("Authorization") || "", `Bearer ${config.secret}`)) return jsonError("身份验证失败", 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  let data: z.infer<typeof input>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 12000) return jsonError("请求内容过长", 413);
    const parsed = input.safeParse(JSON.parse(raw));
    if (!parsed.success) return jsonError("消息格式不正确", 400);
    data = parsed.data;
  } catch { return jsonError("消息格式不正确", 400); }
  if (data.corpId !== config.corpId || data.openKfId !== config.openKfId) return jsonError("客服身份不匹配", 403);
  try {
    const reply = await processWechatMessage(database(), data, new URL(request.url).origin);
    return Response.json({ reply }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BridgeBusy) return jsonError(error.message, 409);
    if (error instanceof BridgeConflict) return jsonError(error.message, 422);
    console.error("WeChat bridge unavailable", error instanceof Error ? error.name : "unknown");
    return jsonError("微信对话暂时不可用", 503);
  }
}
