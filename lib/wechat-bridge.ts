import { randomToken, sha256 } from "./auth";
import { loadConversation } from "./conversation";
import { lookupBinding, redeemBindingCode, wechatIdentity, type WechatBinding } from "./wechat-binding";
import { wechatBotReply } from "./wechat-bot";
import { compactText, currentQuestion } from "./wechat-format";

export type WechatMessage = { corpId: string; openKfId: string; externalUserId: string; msgId: string; text: string; sendTime: number };
type Event = { event_hash: string; identity_hash: string; user_id: string | null; binding_id: string | null; payload_hash: string; state: string; reply: string | null; started_revision: string | null; started_turn: number | null; created_at: string; updated_at: string };
export class BridgeBusy extends Error {}
export class BridgeConflict extends Error {}
const leaseMs = 120_000;
const invitation = (site: string) => `先注册或登录妲灵账号：${site}/account\n在账号设置生成绑定码，再发送「绑定 DL-…」。绑定后可在微信继续网站的对话；发送普通回答表示同意交给 DeepSeek 结合上下文回应，请不要发送联系方式。`;

async function acquireLock(db: D1Database, userId: string, owner: string) {
  const now = new Date().toISOString();
  const write = await db.prepare(`INSERT INTO wechat_locks (user_id, owner, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE wechat_locks.expires_at < ?`)
    .bind(userId, owner, new Date(Date.now() + leaseMs).toISOString(), now).run();
  return Boolean(write.meta.changes);
}

async function stillBound(db: D1Database, identityHash: string, binding: WechatBinding | null) {
  const current = await lookupBinding(db, identityHash);
  return binding ? current?.binding_id === binding.binding_id : !current;
}

export async function processWechatMessage(db: D1Database, message: WechatMessage, site: string): Promise<string> {
  const identityHash = await wechatIdentity(message.corpId, message.openKfId, message.externalUserId);
  const eventHash = await sha256(JSON.stringify([identityHash, message.msgId]));
  const payloadHash = await sha256(JSON.stringify(message));
  const now = new Date().toISOString();
  const age = Date.now() / 1000 - message.sendTime;
  if (age < -60 || age > 3600) return "这条消息已过期，请重新发送「进度」继续。";
  await db.batch([
    db.prepare("DELETE FROM wechat_events WHERE created_at < ?").bind(new Date(Date.now() - 7 * 86400_000).toISOString()),
    db.prepare("DELETE FROM wechat_binding_codes WHERE expires_at < ?").bind(now),
  ]);
  let binding = await lookupBinding(db, identityHash);
  const previous = await db.prepare("SELECT * FROM wechat_events WHERE event_hash = ?").bind(eventHash).first<Event>();
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new BridgeConflict("同一消息标识的内容不一致");
    if (previous.binding_id && previous.binding_id !== binding?.binding_id) return invitation(site);
    if (previous.state === "done") return previous.reply || "请发送「进度」继续。";
    if (Date.parse(previous.updated_at) > Date.now() - leaseMs) throw new BridgeBusy("正在处理前一条消息");
    // An interrupted operation may already have committed. Keep its receipt;
    // do not replay AI or recover private text from a potentially newer turn.
    const recovered = "上条消息的处理结果需要核对，请发送「进度」查看当前问题，再继续回答。";
    await db.prepare("UPDATE wechat_events SET state = 'done', reply = ?, updated_at = ? WHERE event_hash = ? AND state = 'processing'").bind(compactText(recovered), now, eventHash).run();
    return compactText(recovered);
  }

  const owner = randomToken(24);
  const lockUser = binding?.user_id;
  if (lockUser && !await acquireLock(db, lockUser, owner)) throw new BridgeBusy("正在处理前一条消息");
  try {
    const claimed = await db.prepare(`INSERT INTO wechat_events (event_hash, identity_hash, user_id, binding_id, payload_hash, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'processing', ?, ?) ON CONFLICT(event_hash) DO NOTHING`)
      .bind(eventHash, identityHash, binding?.user_id || null, binding?.binding_id || null, payloadHash, now, now).run();
    if (!claimed.meta.changes) throw new BridgeBusy("正在处理这条消息");
    let reply: string;
    if (!binding) {
      const match = /^绑定\s+(DL-[A-HJ-NP-Z2-9]{16})$/i.exec(message.text);
      if (match) {
        const bucket = `wechat-bind:${identityHash}`;
        await db.prepare(`INSERT INTO auth_rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(bucket) DO UPDATE SET hits = CASE WHEN reset_at < ? THEN 1 ELSE hits + 1 END,
          reset_at = CASE WHEN reset_at < ? THEN excluded.reset_at ELSE reset_at END`)
          .bind(bucket, new Date(Date.now() + 3600_000).toISOString(), now, now).run();
        const limit = await db.prepare("SELECT hits FROM auth_rate_limits WHERE bucket = ?").bind(bucket).first<{ hits: number }>();
        binding = (limit?.hits || 0) <= 10 ? await redeemBindingCode(db, identityHash, match[1]) : null;
        reply = binding ? `绑定成功。微信和网站会共用当前进度；发送回答表示同意使用 AI 对话，可在网站随时解绑。\n${currentQuestion(await loadConversation(db, binding.user_id), site)}` : `绑定码无效、已过期或已使用。请在 ${site}/account 重新生成；频繁尝试请一小时后再试。`;
        if (binding) await db.prepare("UPDATE wechat_events SET user_id = ?, binding_id = ? WHERE event_hash = ?").bind(binding.user_id, binding.binding_id, eventHash).run();
      } else reply = invitation(site);
    } else {
      const view = await loadConversation(db, binding.user_id);
      await db.prepare("UPDATE wechat_events SET started_turn = ?, started_revision = ? WHERE event_hash = ?").bind(view.turn, view.revision, eventHash).run();
      reply = await wechatBotReply(db, binding.user_id, message.text, site);
    }
    if (!await stillBound(db, identityHash, binding)) return invitation(site);
    reply = compactText(reply);
    const stored = await db.prepare("UPDATE wechat_events SET state = 'done', reply = ?, updated_at = ? WHERE event_hash = ? AND state = 'processing'").bind(reply, new Date().toISOString(), eventHash).run();
    if (!stored.meta.changes) {
      const cancelled = await db.prepare("SELECT reply FROM wechat_events WHERE event_hash = ?").bind(eventHash).first<{ reply: string | null }>();
      return cancelled?.reply || "资料或绑定已经更新，请发送新消息查看进度。";
    }
    return reply;
  } catch (error) {
    if (error instanceof BridgeBusy) throw error;
    // A transient provider/network fault becomes a durable receipt. The user can
    // submit a new message; a relay retry must not duplicate an uncertain commit.
    const reply = `刚才处理遇到问题，进度已保留。请发送「进度」核对后再回答。${site}/`;
    await db.prepare("UPDATE wechat_events SET state = 'done', reply = ?, updated_at = ? WHERE event_hash = ? AND state = 'processing'").bind(reply, new Date().toISOString(), eventHash).run();
    console.error("WeChat processing failed", error instanceof Error ? error.name : "unknown");
    const safe = await db.prepare("SELECT reply FROM wechat_events WHERE event_hash = ?").bind(eventHash).first<{ reply: string | null }>();
    return safe?.reply || reply;
  } finally {
    if (lockUser) await db.prepare("DELETE FROM wechat_locks WHERE user_id = ? AND owner = ?").bind(lockUser, owner).run();
  }
}
