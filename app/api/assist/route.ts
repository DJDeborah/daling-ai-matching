import { env } from "cloudflare:workers";
import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";
import { containsContact } from "@/lib/profile";
import { z } from "zod";

export const runtime = "edge";

const inputSchema = z.object({ about: z.string().trim().min(10).max(400) });
const outputSchema = z.object({
  intro: z.string().trim().min(1).max(400),
  interests: z.array(z.string().trim().min(1).max(20)).max(8),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先注册或登录", 401);
  if (!env.DEEPSEEK_API_KEY) return jsonError("AI 助手暂时不可用", 503);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError("需要 JSON 请求", 415);
  let input: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1200) return jsonError("内容过长", 413);
    input = JSON.parse(raw);
  } catch { return jsonError("请求内容无效", 400); }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return jsonError("请先写至少 10 个字的自我介绍，最多 400 字", 400);
  if (containsContact(parsed.data.about)) return jsonError("请先移除联系方式再使用 AI 助手", 400);

  const db = database();
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    await db.prepare("DELETE FROM ai_usage WHERE created_at < ?").bind(since).run();
    const usage = await db.prepare(`INSERT INTO ai_usage (event_id, user_id, created_at)
      SELECT ?, ?, ? WHERE (SELECT count(*) FROM ai_usage WHERE user_id = ? AND created_at >= ?) < 10`)
      .bind(eventId, user.userId, now, user.userId, since).run();
    if (!usage.meta.changes) return jsonError("今天的 AI 使用次数已用完，明天再试", 429);
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-flash", thinking: { type: "disabled" }, response_format: { type: "json_object" }, max_tokens: 350,
        messages: [
          { role: "system", content: "你是交友资料写作助手。只依据用户给出的文字润色，不补造经历、身份、年龄、外貌、学校或联系方式。用简体中文返回一个 json 对象，格式示例：{\"intro\":\"润色后的真实自我介绍\",\"interests\":[\"徒步\",\"阅读\"]}。intro 不超过 400 字；interests 最多 8 个，每个不超过 20 字，只提取原文明确表达的兴趣。不得加入电话号码、社交账号或网址。不要返回 json 以外的内容。" },
          { role: "user", content: parsed.data.about },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("provider failed");
    const payload = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
    const choice = payload.choices?.[0];
    if (choice?.finish_reason !== "stop" || !choice.message?.content) throw new Error("incomplete model output");
    const suggested = outputSchema.safeParse(JSON.parse(choice.message.content));
    if (!suggested.success || containsContact(suggested.data.intro) || suggested.data.interests.some(containsContact)) throw new Error("invalid model output");
    return Response.json({ suggestion: suggested.data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await db.prepare("DELETE FROM ai_usage WHERE event_id = ?").bind(eventId).run().catch(() => {});
    console.error("AI suggestion failed");
    return jsonError("AI 助手暂时无法给出建议，请稍后重试", 502);
  }
}
