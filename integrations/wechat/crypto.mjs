import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function signature(token, timestamp, nonce, encrypted) {
  return createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex');
}

export function verifySignature(config, params, encrypted) {
  const { msg_signature: received, timestamp, nonce } = params;
  if (!/^[a-f0-9]{40}$/i.test(received || '') || !/^\d{1,12}$/.test(timestamp || '') || !nonce || nonce.length > 256) {
    throw new Error('invalid_callback_signature');
  }
  const expected = signature(config.token, timestamp, nonce, encrypted);
  if (!timingSafeEqual(Buffer.from(received.toLowerCase()), Buffer.from(expected))) throw new Error('invalid_callback_signature');
}

export function decrypt(config, encrypted) {
  if (!encrypted || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) throw new Error('invalid_callback_ciphertext');
  const ciphertext = Buffer.from(encrypted, 'base64');
  if (!ciphertext.length || ciphertext.length % 16) throw new Error('invalid_callback_ciphertext');
  const key = Buffer.from(config.encodingAesKey + '=', 'base64');
  if (key.length !== 32) throw new Error('invalid_aes_key');
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const padding = padded.at(-1);
  if (padding < 1 || padding > 32 || padding > padded.length || !padded.subarray(-padding).every((value) => value === padding)) {
    throw new Error('invalid_callback_padding');
  }
  const plain = padded.subarray(0, padded.length - padding);
  if (plain.length < 20) throw new Error('invalid_callback_length');
  const length = plain.readUInt32BE(16);
  if (20 + length > plain.length) throw new Error('invalid_callback_length');
  if (plain.subarray(20 + length).toString('utf8') !== config.corpId) throw new Error('invalid_callback_receiver');
  return plain.subarray(20, 20 + length).toString('utf8');
}

export function decryptVerified(config, params, encrypted) {
  verifySignature(config, params, encrypted);
  return decrypt(config, encrypted);
}

export function verifyFreshTimestamp(params, now = Date.now()) {
  if (!/^\d{1,12}$/.test(params.timestamp || '') || Math.abs(Number(params.timestamp) * 1000 - now) > 10 * 60 * 1000) throw new Error('stale_callback_timestamp');
}

// Also used by protocol tests; production only needs decryption.
export function encrypt(config, text, random = randomBytes(16)) {
  const key = Buffer.from(config.encodingAesKey + '=', 'base64');
  const body = Buffer.from(text);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const plain = Buffer.concat([random, length, body, Buffer.from(config.corpId)]);
  const pad = 32 - plain.length % 32;
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64');
}

export function xmlField(xml, field) {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error('unsupported_xml_declaration');
  const matches = [...xml.matchAll(new RegExp(`<${field}\\s*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${field}\\s*>`, 'g'))];
  if (matches.length !== 1) throw new Error('invalid_xml_field');
  return (matches[0][1] ?? matches[0][2]).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function parseNotification(config, params, xml) {
  verifyFreshTimestamp(params);
  const encrypted = xmlField(xml, 'Encrypt');
  const plain = decryptVerified(config, params, encrypted);
  const notification = {
    corpId: xmlField(plain, 'ToUserName'),
    event: xmlField(plain, 'Event'),
    msgType: xmlField(plain, 'MsgType'),
    openKfId: xmlField(plain, 'OpenKfId'),
    token: xmlField(plain, 'Token'),
    createTime: Number(xmlField(plain, 'CreateTime')),
    fingerprint: createHash('sha256').update(encrypted).digest('hex'),
  };
  if (notification.corpId !== config.corpId || notification.openKfId !== config.openKfId || notification.event !== 'kf_msg_or_event' || notification.msgType !== 'event') {
    throw new Error('unexpected_callback');
  }
  if (!Number.isSafeInteger(notification.createTime) || notification.createTime <= 0 || notification.token.length > 128 || !notification.token) throw new Error('invalid_callback');
  return notification;
}
