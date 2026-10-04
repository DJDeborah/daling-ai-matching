import { env } from "cloudflare:workers";

export function wechatConfig() {
  const secret = env.DALING_WECHAT_BRIDGE_SECRET;
  const corpId = env.WECHAT_CORP_ID;
  const openKfId = env.WECHAT_OPEN_KFID;
  if (env.WECHAT_ENABLED !== "true" || !secret || secret.length < 43 || !corpId || !openKfId) return null;
  return { secret, corpId, openKfId };
}

export function constantEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  let different = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) different |= (left[i] || 0) ^ (right[i] || 0);
  return different === 0;
}
