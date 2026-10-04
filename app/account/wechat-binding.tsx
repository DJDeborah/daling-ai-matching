"use client";
import { useEffect, useState } from "react";

type Status = { enabled: boolean; bound: boolean; boundAt?: string };
export default function WechatBinding() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  async function refresh() {
    const response = await fetch("/api/wechat/binding", { cache: "no-store", credentials: "same-origin" });
    if (response.ok) setStatus(await response.json() as Status);
  }
  useEffect(() => { void refresh().catch(() => {}); }, []);
  async function update(method: "POST" | "DELETE") {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch("/api/wechat/binding", { method, credentials: "same-origin" });
      const result = await response.json() as { code?: string; expiresAt?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "暂时无法更新绑定");
      setCode(result.code || ""); setExpiresAt(result.expiresAt || ""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法更新绑定"); }
    finally { setBusy(false); }
  }
  if (!status || (!status.enabled && !status.bound)) return null;
  return <section className="card account-card"><h2>微信里接着聊</h2>
    {status.bound ? <><p className="muted small">已经绑定微信。网站与微信共用这轮对话和匹配报告。</p><button className="secondary-btn" disabled={busy} onClick={() => { if (window.confirm("解除微信绑定？网站里的账号、对话与资料仍然保留。")) void update("DELETE"); }}>解除微信绑定</button></>
      : <><p className="muted small">先生成一次性绑定码，再在妲灵微信客服中发送这条指令。不要把绑定码交给别人。绑定后，微信里的回答也会交给 AI 回应并保存在当前账号。</p>
        {code && <div className="field"><label htmlFor="wechat-code">发送到微信客服的指令</label><input id="wechat-code" readOnly value={`绑定 ${code}`} onFocus={e => e.target.select()}/><p className="hint">有效至 {new Date(expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}，使用一次后失效。</p></div>}
        <div className="candidate-actions"><button className="secondary-btn" disabled={busy} onClick={() => void update("POST")}>{busy ? "请稍候…" : code ? "生成新绑定码" : "生成绑定码"}</button>
          {code && <button className="secondary-btn" onClick={() => { void navigator.clipboard.writeText(`绑定 ${code}`).then(() => setCopied(true)).catch(() => setError("请选中上方指令后手动复制")); }}>{copied ? "已复制" : "复制指令"}</button>}
          <button className="secondary-btn" disabled={busy} onClick={() => { void refresh().catch(() => setError("暂时无法读取绑定状态")); }}>刷新绑定状态</button></div></>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
