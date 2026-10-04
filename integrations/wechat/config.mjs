import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function loadConfig(env = process.env) {
  function required(name) {
    const value = env[name];
    if (!value || value !== value.trim() || /[\r\n\0]/.test(value)) throw new Error(`missing_or_invalid_${name}`);
    return value;
  }
  const site = new URL(required('DALING_SITE_URL'));
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('DALING_SITE_URL_requires_https_origin');
  const config = {
    siteUrl: site.origin,
    bridgeSecret: required('DALING_WECHAT_BRIDGE_SECRET'),
    corpId: required('WECHAT_CORP_ID'),
    appSecret: required('WECHAT_APP_SECRET'),
    openKfId: required('WECHAT_OPEN_KFID'),
    token: required('WECHAT_TOKEN'),
    encodingAesKey: required('WECHAT_ENCODING_AES_KEY'),
    host: env.WECHAT_HOST || '127.0.0.1',
    port: Number(env.WECHAT_PORT || 8788),
    dbPath: resolve(env.WECHAT_DB_PATH || join(homedir(), '.local', 'state', 'daling-wechat', 'relay.sqlite')),
    startAt: null,
    pollMs: 1000,
    bodyLimit: 128 * 1024,
  };
  if (config.bridgeSecret.length < 43 || !/^[A-Za-z0-9]{1,32}$/.test(config.token) || !/^[A-Za-z0-9+/]{43}$/.test(config.encodingAesKey) || Buffer.from(config.encodingAesKey + '=', 'base64').length !== 32) throw new Error('invalid_bridge_or_wechat_credentials');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('invalid_port');
  if (env.WECHAT_START_AT) {
    config.startAt = /^\d+$/.test(env.WECHAT_START_AT) ? Number(env.WECHAT_START_AT) : Date.parse(env.WECHAT_START_AT) / 1000;
    if (!Number.isSafeInteger(config.startAt) || config.startAt < 0) throw new Error('invalid_WECHAT_START_AT');
  }
  return config;
}
