import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { signature, encrypt, decryptVerified, xmlField } from './crypto.mjs';
import { ApiError, WeChatApi, askDaling, truncateUtf8 } from './api.mjs';
import { loadConfig } from './config.mjs';
import { RelayQueue, RelayWorker } from './queue.mjs';
import { createRelayServer } from './relay.mjs';

const now = () => Math.floor(Date.now() / 1000);
const config = {
  corpId: 'test-corp', openKfId: 'test-kf', token: 'TestToken',
  encodingAesKey: Buffer.alloc(32, 7).toString('base64').replace(/=$/, ''),
  appSecret: 'test-app-secret', siteUrl: 'https://daling.example', bridgeSecret: 'test-bridge-secret-at-least-43-characters-for-fixtures',
  bodyLimit: 128 * 1024, startAt: now() - 60,
};
const notification = (fingerprint = 'notification') => ({ fingerprint, token: 'pull-token', createTime: now() });
const message = (msgid = 'message', overrides = {}) => ({ msgid, origin: 3, msgtype: 'text', open_kfid: config.openKfId, external_userid: 'customer', send_time: now(), text: { content: '我喜欢一起逛书店' }, ...overrides });
const page = (messages, cursor = 'cursor', hasMore = 0) => ({ errcode: 0, msg_list: messages, next_cursor: cursor, has_more: hasMore });
const json = (data) => Response.json(data);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'daling-wechat-test-'));
  const cfg = { ...config, dbPath: join(directory, 'relay.sqlite') };
  let queue = new RelayQueue(cfg);
  const result = { config: cfg, get queue() { return queue; }, reopen() { queue.close(); queue = new RelayQueue(cfg); return queue; } };
  t.after(() => {
    queue.close();
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + '/daling-wechat-test-') || absolute.startsWith(resolve(tmpdir()) + '\\daling-wechat-test-'));
    rmSync(absolute, { recursive: true, force: true });
  });
  return result;
}

test('decrypts the Tencent official protocol vector, rejects bad signature and receiver', () => {
  // Public test vector from https://developer.work.weixin.qq.com/document/path/90968.
  const official = { corpId: 'wx5823bf96d3bd56c7', token: 'QDG6eK', encodingAesKey: 'jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C' };
  const encrypted = 'RypEvHKD8QQKFhvQ6QleEB4J58tiPdvo+rtK1I9qca6aM/wvqnLSV5zEPeusUiX5L5X/0lWfrf0QADHHhGd3QczcdCUpj911L3vg3W/sYYvuJTs3TUUkSUXxaccAS0qhxchrRYt66wiSpGLYL42aM6A8dTT+6k4aSknmPj48kzJs8qLjvd4Xgpue06DOdnLxAUHzM6+kDZ+HMZfJYuR+LtwGc2hgf5gsijff0ekUNXZiqATP7PF5mZxZ3Izoun1s4zG4LUMnvw2r+KqCKIw+3IQH03v+BCA9nMELNqbSf6tiWSrXJB3LAVGUcallcrw8V2t9EL4EhzJWrQUax5wLVMNS0+rUPA3k22Ncx4XXZS9o0MBH27Bo6BpNelZpS+/uh9KsNlY6bHCmJU9p8g7m3fVKn28H3KDYA5Pl/T8Z1ptDAVe0lXdQ2YoyyH2uyPIGHBZZIs2pDBS8R07+qN+E7Q==';
  const params = { timestamp: '1409659813', nonce: '1372623149', msg_signature: '477715d11cdb4164915debcba66cb864d751f3e6' };
  const text = decryptVerified(official, params, encrypted);
  assert.equal(xmlField(text, 'Content'), 'hello');
  assert.equal(xmlField(text, 'MsgId'), '4561255354251345929');
  assert.throws(() => decryptVerified(official, { ...params, msg_signature: '0'.repeat(40) }, encrypted), /signature/);
  assert.throws(() => decryptVerified({ ...official, corpId: 'different-corp' }, params, encrypted), /receiver/);
});

test('rejects XML entity declarations and duplicate security fields', () => {
  assert.throws(() => xmlField('<!DOCTYPE xml [<!ENTITY steal SYSTEM "file:///secret">]><Encrypt>x</Encrypt>', 'Encrypt'), /declaration/);
  assert.throws(() => xmlField('<Encrypt>a</Encrypt><Encrypt>b</Encrypt>', 'Encrypt'), /field/);
});

test('HTTP verification and encrypted notification acknowledgement do not invoke AI', async (t) => {
  let queued = 0;
  let saved;
  const server = createRelayServer(config, { enqueue(value) { queued++; saved = value; } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/wechat/callback`;
  function urlFor(encrypted) {
    const timestamp = String(now());
    return base + '?' + new URLSearchParams({ timestamp, nonce: 'test-nonce', msg_signature: signature(config.token, timestamp, 'test-nonce', encrypted), echostr: encrypted });
  }
  const echo = encrypt(config, 'verification-中文');
  const get = await fetch(urlFor(echo));
  assert.equal(get.status, 200);
  assert.equal(await get.text(), 'verification-中文');
  const body = `<xml><ToUserName>${config.corpId}</ToUserName><MsgType>event</MsgType><Event>kf_msg_or_event</Event><OpenKfId>${config.openKfId}</OpenKfId><Token>new-token</Token><CreateTime>${now()}</CreateTime></xml>`;
  const encrypted = encrypt(config, body);
  const post = await fetch(urlFor(encrypted), { method: 'POST', body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>` });
  assert.equal(post.status, 200);
  assert.equal(await post.text(), '');
  assert.equal(queued, 1);
  assert.equal(saved.token, 'new-token');
  const invalid = await fetch(urlFor(encrypted), { method: 'POST', body: '<!DOCTYPE xml><xml><Encrypt>x</Encrypt></xml>' });
  assert.equal(invalid.status, 400);
  assert.equal(queued, 1);
  const tooLarge = await fetch(urlFor(encrypted), { method: 'POST', body: 'x'.repeat(config.bodyLimit + 1) });
  assert.equal(tooLarge.status, 413);
  assert.equal(queued, 1);
});

test('callback does not acknowledge a failed durable enqueue', async (t) => {
  const server = createRelayServer(config, { enqueue() { throw new Error('disk_full'); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const plaintext = `<xml><ToUserName>${config.corpId}</ToUserName><MsgType>event</MsgType><Event>kf_msg_or_event</Event><OpenKfId>${config.openKfId}</OpenKfId><Token>token</Token><CreateTime>${now()}</CreateTime></xml>`;
  const encrypted = encrypt(config, plaintext);
  const params = new URLSearchParams({ timestamp: String(now()), nonce: 'nonce', msg_signature: signature(config.token, String(now()), 'nonce', encrypted) });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/wechat/callback?${params}`, { method: 'POST', body: `<xml><Encrypt>${encrypted}</Encrypt></xml>` });
  assert.equal(response.status, 503);
});

test('atomic cursor and durable inbox filter history, human messages and repeat IDs', (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  assert.equal(f.queue.enqueue(notification()), false);
  const n = f.queue.notification();
  const count = f.queue.stagePage(n, page([message(), message(), message('history', { send_time: f.config.startAt - 1 }), message('human', { origin: 5 }), message('other-account', { open_kfid: 'other' })]));
  assert.equal(count, 1);
  assert.equal(f.queue.meta('cursor'), 'cursor');
  const reopened = f.reopen();
  assert.equal(reopened.meta('cursor'), 'cursor');
  assert.equal(reopened.nextMessage().msg_id, 'message');
  assert.equal(reopened.notification(), undefined);
  assert.equal(reopened.meta('start_at'), String(config.startAt));
});

test('has_more continues even with an empty page; subsequent message gets one AI reply', async (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  const pages = [page([], 'empty-page', 1), page([message()], 'final-page', 0)];
  let aiCalls = 0;
  let sendCalls = 0;
  const worker = new RelayWorker(f.config, f.queue, { async sync(cursor) { if (pages.length === 1) assert.equal(cursor, 'empty-page'); return pages.shift(); }, async state() { return 1; }, async send() { sendCalls++; return { msgid: 'sent' }; } }, async () => { aiCalls++; return '谢谢你分享，接下来我们聊聊周末。'; });
  await worker.tick();
  assert.ok(f.queue.notification());
  await worker.tick();
  assert.equal(aiCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(f.queue.notification(), undefined);
  assert.equal(f.queue.stats().messages[0].status, 'sent');
});

test('Site busy retry preserves turn order and does not lose the same msgId', async (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  f.queue.stagePage(f.queue.notification(), page([message('first'), message('second')]));
  const calls = [];
  const worker = new RelayWorker(f.config, f.queue, { async state() { return 0; }, async send() { return { msgid: 'sent' }; } }, async (msg) => { calls.push(msg.msgId); if (calls.length === 1) throw new ApiError('site', 409); return '一个问题'; });
  await worker.tick();
  await worker.tick();
  assert.deepEqual(calls, ['first']);
  f.queue.db.exec('UPDATE messages SET next_attempt=0');
  await worker.tick();
  await worker.tick();
  assert.deepEqual(calls, ['first', 'first', 'second']);
});

test('human takeover is checked before AI and again before sending', async (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  f.queue.stagePage(f.queue.notification(), page([message('human-before'), message('human-during')]));
  let aiCalls = 0;
  let stateCalls = 0;
  const worker = new RelayWorker(f.config, f.queue, { async state() { return [3, 1, 3][stateCalls++]; }, async send() { assert.fail('must not reply over human'); } }, async () => { aiCalls++; return 'reply'; });
  await worker.tick();
  await worker.tick();
  assert.equal(aiCalls, 1);
  assert.equal(f.queue.stats().messages[0].status, 'skipped');
  assert.equal(f.queue.stats().messages[0].count, 2);
});

test('unknown delivery and crash during send never trigger a blind resend', async (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  f.queue.stagePage(f.queue.notification(), page([message('uncertain'), message('crashed')]));
  let sends = 0;
  const worker = new RelayWorker(f.config, f.queue, { async state() { return 1; }, async send() { sends++; throw new ApiError('send', 'transport', true); } }, async () => 'reply');
  await worker.tick();
  f.queue.updateMessage(f.queue.nextMessage().id, 'sending');
  const reopened = f.reopen();
  const recovered = new RelayWorker(f.config, reopened, { async state() { assert.fail(); }, async send() { assert.fail(); } }, async () => assert.fail());
  await recovered.tick();
  assert.equal(sends, 1);
  assert.equal(reopened.stats().messages[0].status, 'uncertain');
  assert.equal(reopened.stats().messages[0].count, 2);
});

test('delivery failure event marks the persisted sent reply failed without asking AI', (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  f.queue.stagePage(f.queue.notification(), page([message()]));
  const row = f.queue.nextMessage();
  f.queue.sent(row.id, 'tencent-delivery-id');
  f.queue.enqueue(notification('failure-event'));
  f.queue.stagePage(f.queue.notification(), page([{ origin: 4, msgtype: 'event', event: { event_type: 'msg_send_fail', open_kfid: config.openKfId, fail_msgid: 'tencent-delivery-id', fail_type: 10 } }], 'later-cursor'));
  assert.equal(f.queue.stats().messages[0].status, 'failed');
});

test('access token refreshes once on explicit rejection and never follows redirects', async () => {
  let tokenCalls = 0;
  let requests = 0;
  const api = new WeChatApi(config, async (url, options) => {
    assert.equal(url.origin, 'https://qyapi.weixin.qq.com');
    assert.equal(options.redirect, 'error');
    if (url.pathname.endsWith('/gettoken')) return json({ errcode: 0, access_token: `token-${++tokenCalls}`, expires_in: 7200 });
    requests++;
    return json(requests === 1 ? { errcode: 42001 } : { errcode: 0, service_state: 1 });
  });
  assert.equal(await api.state('customer'), 1);
  assert.equal(tokenCalls, 2);
  assert.equal(requests, 2);
  await api.state('customer');
  assert.equal(tokenCalls, 2);
});

test('bridge authentication and UTF8 limit preserve whole Chinese and emoji characters', async () => {
  const reply = '你🙂'.repeat(1000);
  const result = await askDaling(config, { msgId: 'a' }, async (url, options) => {
    assert.equal(url, 'https://daling.example/api/wechat/message');
    assert.equal(options.headers.Authorization, `Bearer ${config.bridgeSecret}`);
    assert.equal(options.redirect, 'error');
    return json({ reply });
  });
  assert.ok(Buffer.byteLength(result) <= 2048);
  assert.ok(!result.includes('\uFFFD'));
  assert.equal(truncateUtf8('短消息'), '短消息');
  await assert.rejects(() => askDaling(config, {}, async () => new Response('', { status: 503 })), (error) => error.code === 503);
});

test('configuration rejects missing credentials, URL credential leaks and malformed dates', () => {
  const env = { DALING_SITE_URL: config.siteUrl, DALING_WECHAT_BRIDGE_SECRET: config.bridgeSecret, WECHAT_CORP_ID: config.corpId, WECHAT_APP_SECRET: config.appSecret, WECHAT_OPEN_KFID: config.openKfId, WECHAT_TOKEN: config.token, WECHAT_ENCODING_AES_KEY: config.encodingAesKey };
  assert.equal(loadConfig(env).siteUrl, config.siteUrl);
  assert.throws(() => loadConfig({ ...env, DALING_SITE_URL: 'https://secret@example.com/' }));
  assert.throws(() => loadConfig({ ...env, WECHAT_APP_SECRET: '' }));
  assert.throws(() => loadConfig({ ...env, WECHAT_START_AT: 'tomorrow' }));
});

test('72-hour cleanup removes all old inbox and uncertain outbox payloads', (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  f.queue.stagePage(f.queue.notification(), page([message('uncertain-old'), message('sent-old'), message('fresh')]));
  const old = now() - 73 * 3600;
  f.queue.db.prepare("UPDATE messages SET sent_at=?,status='uncertain' WHERE msg_id=?").run(old, 'uncertain-old');
  f.queue.db.prepare("UPDATE messages SET sent_at=?,status='sent' WHERE msg_id=?").run(old, 'sent-old');
  assert.equal(f.queue.prune(), 2);
  assert.equal(f.queue.nextMessage().msg_id, 'fresh');
  assert.equal(f.queue.db.prepare('SELECT count(*) AS count FROM messages').get().count, 1);
  assert.equal(f.queue.meta('cursor'), 'cursor');
});

test('only one worker owns the durable queue lease until release or expiry', (t) => {
  const f = fixture(t);
  const clock = Date.now();
  assert.equal(f.queue.acquireLease('first', clock), true);
  assert.equal(f.queue.acquireLease('second', clock + 1000), false);
  assert.equal(f.queue.renewLease('first', clock + 30000), true);
  assert.equal(f.queue.acquireLease('second', clock + 250000), false);
  assert.equal(f.queue.acquireLease('second', clock + 271000), true);
  f.queue.releaseLease('second');
  assert.equal(f.queue.acquireLease('third', clock + 272000), true);
});

test('message delayed more than one hour is skipped without AI or WeChat sends', async (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  f.queue.stagePage(f.queue.notification(), page([message()]));
  const row = f.queue.nextMessage();
  const payload = JSON.parse(row.payload);
  payload.sendTime = now() - 3601;
  f.queue.db.prepare('UPDATE messages SET payload=? WHERE id=?').run(JSON.stringify(payload), row.id);
  const worker = new RelayWorker(f.config, f.queue, { async state() { assert.fail('old messages must not reach Tencent'); } }, async () => assert.fail('old messages must not ask AI'));
  await worker.tick();
  assert.equal(f.queue.stats().messages[0].status, 'expired');
});

test('ready retry rechecks the Site binding receipt instead of sending stale private text', async (t) => {
  const f = fixture(t);
  f.queue.enqueue(notification());
  f.queue.stagePage(f.queue.notification(), page([message()]));
  const row = f.queue.nextMessage();
  f.queue.saveReply(row.id, 'private report from a previous binding');
  let siteCalls = 0;
  let sent;
  const worker = new RelayWorker(f.config, f.queue, { async state() { return 1; }, async send(_message, reply) { sent = reply; return { msgid: 'sent' }; } }, async (payload) => { siteCalls++; assert.equal(payload.msgId, row.msg_id); return '绑定已解除，请先绑定账号。'; });
  await worker.tick();
  assert.equal(siteCalls, 1);
  assert.equal(sent, '绑定已解除，请先绑定账号。');
});
