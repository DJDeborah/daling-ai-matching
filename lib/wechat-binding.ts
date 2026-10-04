import { randomToken, sha256 } from "./auth";

export type WechatBinding = { identity_hash: string; binding_id: string; user_id: string; created_at: string };
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export async function wechatIdentity(corpId: string, openKfId: string, externalUserId: string) {
  return sha256(JSON.stringify([corpId, openKfId, externalUserId]));
}
export async function lookupBinding(db: D1Database, identityHash: string) {
  return db.prepare("SELECT * FROM wechat_bindings WHERE identity_hash = ?").bind(identityHash).first<WechatBinding>();
}
export async function issueBindingCode(db: D1Database, userId: string) {
  const code = "DL-" + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => alphabet[byte % alphabet.length]).join("");
  const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare(`INSERT INTO wechat_binding_codes (user_id, code_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_at = excluded.created_at`)
    .bind(userId, await sha256(code), expiresAt, now).run();
  return { code, expiresAt };
}
export async function redeemBindingCode(db: D1Database, identityHash: string, code: string) {
  const bindingId = randomToken(24), now = new Date().toISOString(), hash = await sha256(code.toUpperCase());
  // D1 batch runs atomically: unique identity/user constraints and a fresh binding ID
  // ensure two competing redemptions cannot consume the same code.
  await db.batch([
    db.prepare(`INSERT INTO wechat_bindings (identity_hash, binding_id, user_id, created_at)
      SELECT ?, ?, c.user_id, ? FROM wechat_binding_codes c JOIN users u ON u.user_id = c.user_id
      WHERE c.code_hash = ? AND c.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM wechat_bindings WHERE identity_hash = ? OR user_id = c.user_id)
      ON CONFLICT DO NOTHING`).bind(identityHash, bindingId, now, hash, now, identityHash),
    db.prepare(`DELETE FROM wechat_binding_codes WHERE code_hash = ? AND
      EXISTS (SELECT 1 FROM wechat_bindings WHERE binding_id = ?)`).bind(hash, bindingId),
  ]);
  const binding = await lookupBinding(db, identityHash);
  return binding?.binding_id === bindingId ? binding : null;
}
export async function unlinkWechat(db: D1Database, userId: string) {
  await db.batch([
    db.prepare("UPDATE wechat_events SET state = 'done', reply = '微信绑定已解除，请重新绑定后发送新消息。', user_id = NULL, started_revision = NULL, started_turn = NULL WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM wechat_locks WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM wechat_binding_codes WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM wechat_bindings WHERE user_id = ?").bind(userId),
  ]);
}
