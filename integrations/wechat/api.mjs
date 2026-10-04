export class ApiError extends Error {
  constructor(operation, code, deliveryUnknown = false) {
    super(`${operation}_${String(code).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}`);
    this.operation = operation;
    this.code = code;
    this.deliveryUnknown = deliveryUnknown;
  }
}

export function truncateUtf8(value, maxBytes = 2048) {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let result = '';
  const suffix = '…';
  let bytes = Buffer.byteLength(suffix);
  for (const character of value) {
    const next = Buffer.byteLength(character);
    if (bytes + next > maxBytes) break;
    result += character;
    bytes += next;
  }
  return result + suffix;
}

export class WeChatApi {
  constructor(config, fetcher = fetch) {
    this.config = config;
    this.fetch = fetcher;
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async token(force = false) {
    if (!force && this.accessToken && this.expiresAt > Date.now()) return this.accessToken;
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
    url.searchParams.set('corpid', this.config.corpId);
    url.searchParams.set('corpsecret', this.config.appSecret);
    let response;
    try { response = await this.fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { throw new ApiError('gettoken', 'transport'); }
    if (!response.ok) throw new ApiError('gettoken', `http${response.status}`);
    let data;
    try { data = await response.json(); } catch { throw new ApiError('gettoken', 'invalid_json'); }
    if (data.errcode !== 0 || typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in < 1) throw new ApiError('gettoken', Number.isInteger(data.errcode) ? data.errcode : 'invalid_response');
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + Math.max(1, data.expires_in - 120) * 1000;
    return this.accessToken;
  }

  async request(path, body, refreshed = false) {
    if (!['kf/sync_msg', 'kf/service_state/get', 'kf/send_msg'].includes(path)) throw new ApiError('api', 'unsupported_path');
    const send = path === 'kf/send_msg';
    const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`);
    url.searchParams.set('access_token', await this.token());
    let response;
    try { response = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch { throw new ApiError(path.replaceAll('/', '_'), 'transport', send); }
    if (!response.ok) throw new ApiError(path.replaceAll('/', '_'), `http${response.status}`, send);
    let data;
    try { data = await response.json(); } catch { throw new ApiError(path.replaceAll('/', '_'), 'invalid_json', send); }
    if (!Number.isInteger(data.errcode)) throw new ApiError(path.replaceAll('/', '_'), 'invalid_response', send);
    if ([40001, 40014, 42001].includes(data.errcode) && !refreshed) {
      await this.token(true);
      return this.request(path, body, true);
    }
    if (data.errcode !== 0) throw new ApiError(path.replaceAll('/', '_'), data.errcode);
    return data;
  }

  sync(cursor, notificationToken) {
    return this.request('kf/sync_msg', { ...(cursor ? { cursor } : {}), ...(notificationToken ? { token: notificationToken } : {}), limit: 1000, voice_format: 0, open_kfid: this.config.openKfId });
  }

  async state(externalUserId) {
    const data = await this.request('kf/service_state/get', { open_kfid: this.config.openKfId, external_userid: externalUserId });
    if (![0, 1, 2, 3, 4].includes(data.service_state)) throw new ApiError('state', 'invalid_response');
    return data.service_state;
  }

  send(message, reply, outgoingId) {
    return this.request('kf/send_msg', { touser: message.externalUserId, open_kfid: this.config.openKfId, msgid: outgoingId, msgtype: 'text', text: { content: truncateUtf8(reply) } });
  }
}

export async function askDaling(config, message, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${config.siteUrl}/api/wechat/message`, { method: 'POST', headers: { Authorization: `Bearer ${config.bridgeSecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(message), signal: AbortSignal.timeout(90000), redirect: 'error' });
  } catch { throw new ApiError('site', 'transport'); }
  if (!response.ok) throw new ApiError('site', response.status);
  let data;
  try { data = await response.json(); } catch { throw new ApiError('site', 'invalid_json'); }
  if (typeof data.reply !== 'string' || !data.reply.trim() || Buffer.byteLength(data.reply) > 128 * 1024) throw new ApiError('site', 'invalid_reply');
  return truncateUtf8(data.reply);
}
