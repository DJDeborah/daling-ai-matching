import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ApiError, askDaling } from './api.mjs';

export class RelayQueue {
  constructor(config) {
    this.config = config;
    mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(config.dbPath);
    chmodSync(config.dbPath, 0o600);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (
        fingerprint TEXT PRIMARY KEY, token TEXT NOT NULL, created_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, msg_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
        sent_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0, reply TEXT, outgoing_id TEXT NOT NULL,
        error_code TEXT, delivered_id TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_status_id ON messages(status, id);
      CREATE INDEX IF NOT EXISTS messages_sent_at ON messages(sent_at);
      CREATE INDEX IF NOT EXISTS notifications_received_at ON notifications(received_at);`);
    const identity = `${config.corpId}:${config.openKfId}`;
    if (this.meta('identity') && this.meta('identity') !== identity) {
      this.db.close();
      throw new Error('database_account_mismatch');
    }
    this.setMeta('identity', identity);
    if (!this.meta('start_at')) this.setMeta('start_at', String(config.startAt ?? Math.floor(Date.now() / 1000)));
  }

  meta(key) { return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value; }
  setMeta(key, value) { this.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }

  transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  acquireLease(owner, now = Date.now()) {
    return this.transaction(() => {
      if (this.meta('worker_owner') !== owner && Number(this.meta('worker_until') || 0) > now) return false;
      this.setMeta('worker_owner', owner);
      this.setMeta('worker_until', String(now + 240000));
      // An interrupted send may already have reached Tencent. Never resend it.
      this.db.exec("UPDATE messages SET status='uncertain', error_code='process_restart_during_send' WHERE status='sending'");
      return true;
    });
  }

  releaseLease(owner) {
    this.transaction(() => { if (this.meta('worker_owner') === owner) this.setMeta('worker_until', '0'); });
  }

  renewLease(owner, now = Date.now()) {
    return this.transaction(() => {
      if (this.meta('worker_owner') !== owner) return false;
      this.setMeta('worker_until', String(now + 240000));
      return true;
    });
  }

  enqueue(notification, now = Date.now()) {
    return this.transaction(() => {
      const result = this.db.prepare('INSERT OR IGNORE INTO notifications(fingerprint,token,created_at,received_at) VALUES (?,?,?,?)').run(notification.fingerprint, notification.token, notification.createTime, now);
      if (notification.token && notification.createTime >= Number(this.meta('token_created_at') || 0)) {
        this.setMeta('token', notification.token);
        this.setMeta('token_created_at', String(notification.createTime));
      }
      return Number(result.changes) > 0;
    });
  }

  notification(now = Date.now()) {
    return this.db.prepare("SELECT * FROM notifications WHERE status='pending' AND next_attempt<=? ORDER BY received_at LIMIT 1").get(now);
  }

  token(now = Date.now()) {
    const created = Number(this.meta('token_created_at') || 0) * 1000;
    return created > now - 9 * 60 * 1000 && created < now + 60000 ? this.meta('token') : undefined;
  }

  stagePage(notification, page) {
    if (!Array.isArray(page.msg_list) || typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor.length > 64 || ![0, 1].includes(page.has_more)) throw new ApiError('sync', 'invalid_page');
    const previous = this.meta('cursor');
    if (page.has_more === 1 && page.next_cursor === previous) throw new ApiError('sync', 'non_advancing_cursor');
    return this.transaction(() => {
      let inserted = 0;
      const insert = this.db.prepare('INSERT OR IGNORE INTO messages(msg_id,payload,sent_at,outgoing_id) VALUES (?,?,?,?)');
      for (const item of page.msg_list) {
        if (!item || typeof item !== 'object') continue;
        if (item.origin === 4 && item.msgtype === 'event' && item.event?.event_type === 'msg_send_fail' && item.event.open_kfid === this.config.openKfId && typeof item.event.fail_msgid === 'string') {
          this.db.prepare("UPDATE messages SET status='failed',error_code=? WHERE (outgoing_id=? OR delivered_id=?) AND status IN ('sent','uncertain')").run(`wecom_delivery_failure_${Number(item.event.fail_type)}`, item.event.fail_msgid, item.event.fail_msgid);
          continue;
        }
        if (item.origin !== 3 || item.msgtype !== 'text' || item.open_kfid !== this.config.openKfId) continue;
        if (!Number.isSafeInteger(item.send_time) || item.send_time < Number(this.meta('start_at')) || item.send_time < Date.now() / 1000 - 3600) continue;
        if (typeof item.msgid !== 'string' || !item.msgid || item.msgid.length > 256 || typeof item.external_userid !== 'string' || !item.external_userid || item.external_userid.length > 256) continue;
        if (typeof item.text?.content !== 'string' || !item.text.content.trim() || Buffer.byteLength(item.text.content) > 12 * 1024) continue;
        const payload = { corpId: this.config.corpId, openKfId: this.config.openKfId, externalUserId: item.external_userid, msgId: item.msgid, text: item.text.content, sendTime: item.send_time };
        const outgoingId = 'dl_' + createHash('sha256').update(`${this.config.corpId}:${this.config.openKfId}:${item.msgid}`).digest('hex').slice(0, 28);
        inserted += Number(insert.run(item.msgid, JSON.stringify(payload), item.send_time, outgoingId).changes);
      }
      this.setMeta('cursor', page.next_cursor);
      if (!page.has_more) this.db.prepare("UPDATE notifications SET status='done',token='' WHERE fingerprint=?").run(notification.fingerprint);
      else this.db.prepare('UPDATE notifications SET attempts=0,next_attempt=0,error_code=NULL WHERE fingerprint=?').run(notification.fingerprint);
      return inserted;
    });
  }

  nextMessage(now = Date.now()) {
    // Strict queue order preserves questionnaire turns. Retry delays block later
    // turns until the earliest pending turn is accepted or explicitly failed.
    const row = this.db.prepare("SELECT * FROM messages WHERE status IN ('pending','ready') ORDER BY id LIMIT 1").get();
    return row && row.next_attempt <= now ? row : null;
  }

  updateMessage(id, status, error = null) { this.db.prepare('UPDATE messages SET status=?,error_code=? WHERE id=?').run(status, error, id); }
  saveReply(id, reply) { this.db.prepare("UPDATE messages SET status='ready',reply=?,attempts=0,next_attempt=0,error_code=NULL WHERE id=?").run(reply, id); }
  sent(id, deliveredId) { this.db.prepare("UPDATE messages SET status='sent',delivered_id=?,error_code=NULL WHERE id=?").run(deliveredId || '', id); }

  retry(table, key, row, code, now = Date.now()) {
    if (!['messages', 'notifications'].includes(table)) throw new Error('invalid_retry_table');
    const column = table === 'messages' ? 'id' : 'fingerprint';
    const attempts = row.attempts + 1;
    const delay = Math.min(5 * 60 * 1000, 2000 * 2 ** Math.min(attempts, 8));
    this.db.prepare(`UPDATE ${table} SET attempts=?,next_attempt=?,error_code=? WHERE ${column}=?`).run(attempts, now + delay, String(code).slice(0, 100), key);
  }

  stats() {
    return {
      messages: this.db.prepare('SELECT status,count(*) AS count FROM messages GROUP BY status').all(),
      pendingNotifications: this.db.prepare("SELECT count(*) AS count FROM notifications WHERE status='pending'").get().count,
      startAt: Number(this.meta('start_at')),
    };
  }
  prune(now = Date.now()) {
    const result = this.transaction(() => {
      const removed = this.db.prepare('DELETE FROM messages WHERE sent_at<?').run(Math.floor(now / 1000) - 72 * 3600);
      this.db.prepare('DELETE FROM notifications WHERE received_at<?').run(now - 72 * 3600 * 1000);
      this.db.prepare("UPDATE notifications SET token='' WHERE created_at<?").run(Math.floor(now / 1000) - 600);
      if (this.meta('token') && Number(this.meta('token_created_at') || 0) < now / 1000 - 600) this.setMeta('token', '');
      return Number(removed.changes);
    });
    // secure_delete removes freed payload bytes; checkpoint also clears old WAL
    // frames. External backups remain the operator's responsibility.
    if (result) this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return result;
  }
  close() { this.db.close(); }
}

export class RelayWorker {
  constructor(config, queue, api, site = (message) => askDaling(config, message), logger = () => {}) {
    Object.assign(this, { config, queue, api, site, logger });
    this.running = false;
    this.owner = randomUUID();
  }

  async tick() {
    if (this.running) return;
    if (!this.queue.acquireLease(this.owner)) return;
    this.running = true;
    const heartbeat = setInterval(() => {
      try { this.queue.renewLease(this.owner); }
      catch { this.logger({ event: 'worker_lease_error', code: 'database' }); }
    }, 30000);
    try {
      this.queue.prune();
      const notification = this.queue.notification();
      if (notification) {
        try {
          const page = await this.api.sync(this.queue.meta('cursor'), this.queue.token());
          this.queue.stagePage(notification, page);
        } catch (error) {
          this.queue.retry('notifications', notification.fingerprint, notification, error instanceof ApiError ? error.message : 'sync_internal');
          this.logger({ event: 'sync_retry', code: error instanceof ApiError ? error.message : 'internal' });
        }
      }
      const row = this.queue.nextMessage();
      if (row) await this.process(row);
    } finally { clearInterval(heartbeat); this.queue.releaseLease(this.owner); this.running = false; }
  }

  async process(row) {
    const message = JSON.parse(row.payload);
    if (message.sendTime <= Date.now() / 1000 - 3600) { this.queue.updateMessage(row.id, 'expired'); return; }
    try {
      if (![0, 1].includes(await this.api.state(message.externalUserId))) { this.queue.updateMessage(row.id, 'skipped', 'human_or_closed_state'); return; }
      // Ready retries reuse the same Site msgId receipt without another AI call.
      // The Site rechecks binding_id before releasing any previously cached text.
      const reply = await this.site(message);
      this.queue.saveReply(row.id, reply);
      // Human takeover can happen during the AI request.
      if (![0, 1].includes(await this.api.state(message.externalUserId))) { this.queue.updateMessage(row.id, 'skipped', 'human_or_closed_state'); return; }
      this.queue.updateMessage(row.id, 'sending');
      try {
        const result = await this.api.send(message, reply, row.outgoing_id);
        this.queue.sent(row.id, result.msgid);
      } catch (error) {
        if (error instanceof ApiError && !error.deliveryUnknown) {
          this.queue.updateMessage(row.id, 'ready');
          this.queue.retry('messages', row.id, row, error.message);
          this.logger({ event: 'send_rejected', code: error.message });
        } else {
          this.queue.updateMessage(row.id, 'uncertain', 'send_delivery_unknown');
          this.logger({ event: 'send_uncertain', code: 'manual_review_required' });
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.operation === 'site' && [400, 413, 422].includes(error.code)) {
        this.queue.updateMessage(row.id, 'failed', error.message);
      } else this.queue.retry('messages', row.id, row, error instanceof ApiError ? error.message : 'worker_internal');
      this.logger({ event: 'message_retry_or_failure', code: error instanceof ApiError ? error.message : 'internal' });
    }
  }
}
