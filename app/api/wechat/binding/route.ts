import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import { wechatConfig } from "@/lib/wechat-config";
import { issueBindingCode, unlinkWechat } from "@/lib/wechat-binding";
export const runtime = "edge";
const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  const binding = await database().prepare("SELECT created_at FROM wechat_bindings WHERE user_id = ?").bind(user.userId).first<{ created_at: string }>();
  return json({ enabled: Boolean(wechatConfig()), bound: Boolean(binding), boundAt: binding?.created_at });
}
export async function POST(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  if (!wechatConfig()) return jsonError("微信入口尚未开通", 503);
  const db = database();
  const binding = await db.prepare("SELECT user_id FROM wechat_bindings WHERE user_id = ?").bind(user.userId).first();
  if (binding) return jsonError("账号已经绑定，换绑前请先解除绑定", 409);
  const latest = await db.prepare("SELECT created_at FROM wechat_binding_codes WHERE user_id = ?").bind(user.userId).first<{ created_at: string }>();
  if (latest && Date.parse(latest.created_at) > Date.now() - 30_000) return jsonError("请等 30 秒再生成新绑定码", 429);
  return json(await issueBindingCode(db, user.userId));
}
export async function DELETE(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  await unlinkWechat(database(), user.userId);
  return json({ ok: true });
}
