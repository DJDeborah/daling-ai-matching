import { env } from "cloudflare:workers";

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export async function reserveAiCall(db: D1Database, userId: string, maxPerDay = 80): Promise<string | null> {
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  await db.prepare("DELETE FROM ai_usage WHERE created_at < ?").bind(since).run();
  const result = await db.prepare(`INSERT INTO ai_usage (event_id, user_id, created_at)
    SELECT ?, ?, ? WHERE (SELECT count(*) FROM ai_usage WHERE user_id = ? AND created_at >= ?) < ?`)
    .bind(eventId, userId, now, userId, since, maxPerDay).run();
  return result.meta.changes ? eventId : null;
}

export async function releaseAiCall(db: D1Database, eventId: string): Promise<void> {
  await db.prepare("DELETE FROM ai_usage WHERE event_id = ?").bind(eventId).run().catch(() => {});
}

export async function deepseekJson(messages: AiMessage[], maxTokens = 400, signal = AbortSignal.timeout(20000)): Promise<unknown> {
  if (!env.DEEPSEEK_API_KEY) throw new Error("AI secret is unavailable");
  // JSON mode can occasionally return empty or malformed content. Retry once
  // within the same time budget; never use a guessed local answer.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash", thinking: { type: "disabled" }, temperature: 0.4,
      ...(attempt === 0 ? { response_format: { type: "json_object" } } : {}),
      max_tokens: maxTokens,
      messages: attempt === 0 ? messages : [
        ...messages.slice(0, -1),
        { role: "system", content: "上一生成没有返回可解析的完整JSON。本次严格遵守前面规定的字段与枚举，只输出一个完整JSON对象，以{开始、以}结束。不能只输出空格、普通聊天文本或格式说明；自然聊天内容必须放在规定的JSON字段里。" },
        ...messages.slice(-1),
      ],
    }),
    signal,
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const result = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
  const choice = result.choices?.[0];
  if (choice?.finish_reason !== "stop") {
    if (attempt === 0 && choice?.finish_reason === "length") continue;
    throw new Error("Incomplete AI response");
  }
  try {
    if (!choice.message?.content?.trim()) throw new Error("Empty AI response");
    const content = choice.message.content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    return JSON.parse(content);
  } catch {
    if (attempt === 1) throw new Error("Invalid AI JSON response");
  }
  }
  throw new Error("Invalid AI JSON response");
}
