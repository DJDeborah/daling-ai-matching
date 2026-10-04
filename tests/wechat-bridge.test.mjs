import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createRequire, Module } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import ts from "typescript";

// Execute actual TypeScript modules with platform/AI boundaries replaced;
// SQL runs against SQLite with the project's real migration history.
const root = fileURLToPath(new URL("../", import.meta.url));
function load(file, dependencies) {
  const filename = path.join(root, file);
  const module = new Module(filename);
  const require = createRequire(filename);
  module.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  module._compile(outputText, filename);
  return module.exports;
}
const auth = {
  randomToken: n => randomBytes(n).toString("base64url"),
  sha256: async text => createHash("sha256").update(text).digest("hex"),
};
const format = load("lib/wechat-format.ts", {});
const binding = load("lib/wechat-binding.ts", { "./auth": auth });

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(path.join(root, "drizzle")).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(path.join(root, "drizzle", file), "utf8"));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        sync() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
        async run() { return statement.sync(); },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      }; return statement;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = statements.map(statement => statement.sync()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  for (const id of ["alice", "bob"]) sqlite.prepare("INSERT INTO users VALUES (?, ?, 'hash', 'salt', 1, ?)").run(id, id, new Date().toISOString());
  const views = new Map(["alice", "bob"].map(id => [id, { turn: 0, revision: "initial", step: 0, totalSteps: 10, status: "collecting", messages: [], question: "怎么称呼你？", example: null }]));
  let calls = 0, pause = null;
  const conversation = { async loadConversation(_, id) { assert.ok(sqlite.prepare("SELECT 1 FROM users WHERE user_id = ?").get(id)); return views.get(id); } };
  const bridge = load("lib/wechat-bridge.ts", {
    "./auth": auth, "./conversation": conversation, "./wechat-binding": binding, "./wechat-format": format,
    "./wechat-bot": { async wechatBotReply(_, id, text) { calls++; if (pause) await pause; const view = views.get(id); view.turn++; return `private-${id}-${text}`; } },
  });
  const message = (overrides = {}) => ({ corpId: "corp", openKfId: "kf", externalUserId: "wechat-a", msgId: randomBytes(8).toString("hex"), text: "普通回答", sendTime: Math.floor(Date.now() / 1000), ...overrides });
  const site = "https://example.com";
  return { db, sqlite, bridge, message, views, conversation, site, calls: () => calls, pause: value => { pause = value; } };
}
async function bind(f, user = "alice", identity = "wechat-a") {
  const { code } = await binding.issueBindingCode(f.db, user);
  const hash = await binding.wechatIdentity("corp", "kf", identity);
  const result = await binding.redeemBindingCode(f.db, hash, code);
  assert.equal(result.user_id, user);
  return result;
}

test("binding codes are hashed, expire, are single use and account exclusive", async t => {
  const f = fixture(t), { code } = await binding.issueBindingCode(f.db, "alice");
  assert.notEqual(f.sqlite.prepare("SELECT code_hash FROM wechat_binding_codes").get().code_hash, code);
  const first = await binding.redeemBindingCode(f.db, "identity-a", code);
  assert.equal(first.user_id, "alice");
  assert.equal(await binding.redeemBindingCode(f.db, "identity-b", code), null);
  const expired = await binding.issueBindingCode(f.db, "bob");
  f.sqlite.exec("UPDATE wechat_binding_codes SET expires_at = '2000-01-01' WHERE user_id = 'bob'");
  assert.equal(await binding.redeemBindingCode(f.db, "identity-c", expired.code), null);
});
test("a duplicate message invokes AI and advances only once; changed replay is rejected", async t => {
  const f = fixture(t); await bind(f); const message = f.message();
  const first = await f.bridge.processWechatMessage(f.db, message, f.site);
  assert.equal(await f.bridge.processWechatMessage(f.db, message, f.site), first);
  assert.equal(f.calls(), 1); assert.equal(f.views.get("alice").turn, 1);
  await assert.rejects(f.bridge.processWechatMessage(f.db, { ...message, text: "改动" }, f.site), f.bridge.BridgeConflict);
});
test("per-account lock rejects a concurrent message until the first finishes", async t => {
  const f = fixture(t); await bind(f);
  let release; f.pause(new Promise(resolve => { release = resolve; }));
  const first = f.bridge.processWechatMessage(f.db, f.message(), f.site);
  while (!f.calls()) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.bridge.processWechatMessage(f.db, f.message(), f.site), f.bridge.BridgeBusy);
  release(); await first; assert.equal(f.calls(), 1);
});
test("unlink during processing suppresses private reply, and old message cannot enter a new account", async t => {
  const f = fixture(t); await bind(f); const message = f.message();
  let release; f.pause(new Promise(resolve => { release = resolve; }));
  const pending = f.bridge.processWechatMessage(f.db, message, f.site);
  while (!f.calls()) await new Promise(resolve => setImmediate(resolve));
  await binding.unlinkWechat(f.db, "alice");
  release(); assert.doesNotMatch(await pending, /private-alice/);
  await bind(f, "bob");
  assert.doesNotMatch(await f.bridge.processWechatMessage(f.db, message, f.site), /private/);
  assert.equal(f.calls(), 1); assert.equal(f.views.get("bob").turn, 0);
});
test("profile deletion cancels an in-flight report receipt atomically", async t => {
  const f = fixture(t); await bind(f);
  let release; f.pause(new Promise(resolve => { release = resolve; }));
  const pending = f.bridge.processWechatMessage(f.db, f.message(), f.site);
  while (!f.calls()) await new Promise(resolve => setImmediate(resolve));
  await f.db.batch([f.db.prepare("UPDATE wechat_events SET state = 'done', reply = '资料已删除' WHERE user_id = 'alice'")]);
  release(); assert.equal(await pending, "资料已删除");
  assert.equal(f.sqlite.prepare("SELECT reply FROM wechat_events").get().reply, "资料已删除");
});
test("a crashed operation returns a safe receipt without replaying AI", async t => {
  const f = fixture(t); await bind(f); const message = f.message();
  await f.bridge.processWechatMessage(f.db, message, f.site);
  f.sqlite.exec("UPDATE wechat_events SET state = 'processing', reply = NULL, updated_at = '2000-01-01'");
  const reply = await f.bridge.processWechatMessage(f.db, message, f.site);
  assert.match(reply, /核对/); assert.doesNotMatch(reply, /private/); assert.equal(f.calls(), 1);
});
test("unbound and old messages never invoke AI", async t => {
  const f = fixture(t);
  assert.match(await f.bridge.processWechatMessage(f.db, f.message(), f.site), /注册或登录/);
  await bind(f);
  assert.match(await f.bridge.processWechatMessage(f.db, f.message({ sendTime: Math.floor(Date.now() / 1000) - 4000 }), f.site), /过期/);
  assert.equal(f.calls(), 0);
});
test("long report fits Tencent UTF8 limit and preserves source and authenticated link", () => {
  const report = { scope: "preview", answeredTopics: 2, totalTopics: 10, summary: "长😀说明".repeat(500), analysis: null, missingBasics: ["年龄"], realCandidates: [], demoCandidates: [{ name: "体验甲", age: 28, city: "上海", reasons: ["共同点"], eligibility: "approximate", unmetConditions: ["年龄范围不符"], unknownConditions: [], compatibility: { dimensions: [] }, narrative: null, overallScore: null }] };
  const reply = format.formatMatchingReport(report, "https://example.com");
  assert.ok(Buffer.byteLength(reply) <= 2048); assert.match(reply, /实验档案/); assert.match(reply, /完整报告：https:\/\/example.com\//); assert.match(reply, /年龄范围不符/); assert.doesNotMatch(reply, /0%|\uFFFD/);
});
test("bridge endpoint authenticates relay and rejects arbitrary userId and wrong customer-service identity", async t => {
  const f = fixture(t), secret = "a".repeat(43);
  const config = load("lib/wechat-config.ts", { "cloudflare:workers": { env: { WECHAT_ENABLED: "true", WECHAT_CORP_ID: "corp", WECHAT_OPEN_KFID: "kf", DALING_WECHAT_BRIDGE_SECRET: secret } } });
  const route = load("app/api/wechat/message/route.ts", { "@/lib/database": { database: () => f.db, jsonError: (error, status) => Response.json({ error }, { status }) }, "@/lib/wechat-config": config, "@/lib/wechat-bridge": f.bridge });
  const request = (body, token = secret) => new Request("https://example.com/api/wechat/message", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request(f.message(), "wrong"))).status, 401);
  assert.equal((await route.POST(request({ ...f.message(), userId: "bob" }))).status, 400);
  assert.equal((await route.POST(request(f.message({ corpId: "other" })))).status, 403);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM wechat_events").get().n, 0);
});
test("bot requires explicit AI report consent, and a binding command never enters AI", async () => {
  let answers = 0, analyses = 0;
  const view = { status: "collecting", turn: 0, revision: "rev", step: 1, totalSteps: 10, inputLimit: 700, messages: [], question: "住在哪座城市？", example: null };
  const report = { scope: "preview", answeredTopics: 1, totalTopics: 10, analysis: null, summary: "只基于已知资料", demoCandidates: [], missingBasics: [], realCandidates: [] };
  const bot = load("lib/wechat-bot.ts", {
    "./conversation": { loadConversation: async () => view, transitionConversation: async () => { view.status = "paused"; return view; }, answerConversation: async () => { answers++; return { ...view, status: "collecting", messages: [{ role: "assistant", content: "根据回答的回应" }] }; }, ConversationConflict: class extends Error {}, ConversationAiUnavailable: class extends Error {}, ConversationLimit: class extends Error {}, ConversationValidation: class extends Error {} },
    "./profile": { containsContact: () => false }, "./wechat-format": format,
    "./report-service": { getMatchingReport: async () => ({ report }), analyzeMatchingReport: async () => { analyses++; return { report, aiStatus: "generated" }; } },
  });
  const reply = text => bot.wechatBotReply({}, "alice", text, "https://example.com");
  assert.match(await reply("绑定 DL-ABCDEFGH23456789"), /已经?绑定|已绑定/); assert.equal(answers, 0);
  assert.match(await reply("分析"), /确认分析/); assert.equal(analyses, 0);
  await reply("我喜欢继续逛书店"); assert.equal(answers, 1);
  await reply("确认分析"); assert.equal(analyses, 1);
});
