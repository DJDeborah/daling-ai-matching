import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { decryptVerified, parseNotification, verifyFreshTimestamp } from './crypto.mjs';
import { WeChatApi } from './api.mjs';
import { RelayQueue, RelayWorker } from './queue.mjs';

export function createRelayServer(config, queue) {
  return createServer(async (request, response) => {
    function reply(status, body = '') {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(body);
    }
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/health' && request.method === 'GET') { reply(200, 'ok'); return; }
      if (url.pathname !== '/wechat/callback') { reply(404); return; }
      if (request.method === 'GET') {
        const params = Object.fromEntries(url.searchParams);
        verifyFreshTimestamp(params);
        reply(200, decryptVerified(config, params, params.echostr));
        return;
      }
      if (request.method !== 'POST') { reply(405); return; }
      if (Number(request.headers['content-length'] || 0) > config.bodyLimit) { reply(413); request.resume(); return; }
      const chunks = [];
      let size = 0;
      // Reserve the remaining callback deadline for SQLite's bounded lock wait.
      const deadline = setTimeout(() => { if (!response.headersSent) reply(408); request.destroy(); }, 2000);
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > config.bodyLimit) { reply(413); request.resume(); return; }
          chunks.push(chunk);
        }
      } finally { clearTimeout(deadline); }
      const xml = Buffer.concat(chunks).toString('utf8');
      const notification = parseNotification(config, Object.fromEntries(url.searchParams), xml);
      try { queue.enqueue(notification); }
      catch { reply(503); return; }
      reply(200);
    } catch {
      if (!response.headersSent && !response.destroyed) reply(400);
    }
  });
}

export async function main() {
  process.umask(0o077);
  const config = loadConfig();
  const queue = new RelayQueue(config);
  const logger = (item) => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...item }) + '\n');
  const worker = new RelayWorker(config, queue, new WeChatApi(config), undefined, logger);
  const server = createRelayServer(config, queue);
  server.requestTimeout = 4500;
  server.headersTimeout = 4500;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  logger({ event: 'relay_started', port: config.port });
  // Official docs warn callbacks can be dropped; periodically reconcile the
  // durable cursor. Expired notification tokens are never reused.
  const reconcile = () => queue.enqueue({ fingerprint: `reconcile:${Math.floor(Date.now() / 300000)}`, token: '', createTime: 0 });
  reconcile();
  const reconcileTimer = setInterval(reconcile, 300000);
  const timer = setInterval(() => worker.tick().catch(() => logger({ event: 'worker_error', code: 'internal' })), config.pollMs);
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    clearInterval(reconcileTimer);
    server.close();
    // Finish a current request before closing its durable queue.
    while (worker.running) await new Promise((resolve) => setTimeout(resolve, 100));
    queue.close();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { server, queue, worker, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('Relay startup failed. Check environment configuration and private database permissions.\n'); process.exitCode = 1; });
}
