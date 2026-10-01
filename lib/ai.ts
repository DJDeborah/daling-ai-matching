import { env } from "cloudflare:workers";

export type AiMessage = { role: "system" | "user"; content: string };

export async function reserveAiCall(db: D1Database, userId: string, maxPerDay = 40): Promise<string | null> {
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

export async function deepseekJson(messages: AiMessage[], maxTokens = 400): Promise<unknown> {
  if (!env.DEEPSEEK_API_KEY) throw new Error("AI secret is unavailable");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash", thinking: { type: "disabled" },
      response_format: { type: "json_object" }, max_tokens: maxTokens, messages,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const result = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
  const choice = result.choices?.[0];
  if (choice?.finish_reason !== "stop" || !choice.message?.content) throw new Error("Incomplete AI response");
  return JSON.parse(choice.message.content);
}
