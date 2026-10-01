"use client";

import { useState } from "react";

type AuthMode = "register" | "login";

async function send(url: string, method: "POST" | "DELETE", body?: Record<string, string | boolean>) {
  const response = await fetch(url, {
    method, cache: "no-store", credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error ?? "请求失败，请稍后重试");
}

export default function AccountApp({ username }: { username: string | null }) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "register" && password !== confirm) return setError("两次输入的密码不一致");
    setBusy(true); setError("");
    try {
      await send(`/api/auth/${mode}`, "POST", mode === "register" ? { username: name, password, adultConfirmed } : { username: name, password });
      window.location.assign("/");
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError("");
    try { await send("/api/auth/logout", "POST"); window.location.assign("/"); }
    catch (e) { setError(e instanceof Error ? e.message : "退出失败"); setBusy(false); }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await send("/api/auth/password", "POST", { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setMessage("密码已修改，其他设备的登录已退出。");
    } catch (e) { setError(e instanceof Error ? e.message : "修改失败"); }
    finally { setBusy(false); }
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm("确定永久删除账号和全部资料吗？此操作无法恢复。")) return;
    setBusy(true); setError("");
    try {
      await send("/api/auth/account", "DELETE", { password: deletePassword });
      try { sessionStorage.removeItem("daling-draft"); sessionStorage.removeItem("daling-step"); } catch { /* optional draft */ }
      window.location.assign("/");
    } catch (e) { setError(e instanceof Error ? e.message : "删除失败"); setBusy(false); }
  }

  return <div className="account-shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">✳</span>妲灵</a><span className="topbar-note">双向选择，认真认识</span><a className="topbar-link" href="/">返回匹配</a></header>
    <main className="account-main">
      <p className="section-kicker">你的妲灵账号</p>
      <h1>{username ? `你好，${username}` : "注册或登录"}</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      {!username ? <div className="card account-card">
        <div className="tabbar" role="tablist" aria-label="账号操作">
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>注册</button>
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>登录</button>
        </div>
        <form onSubmit={submitAuth}>
          <div className="field"><label htmlFor="username">用户名</label><input id="username" autoComplete="username" required minLength={3} maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="3–24 位英文字母、数字或下划线" /></div>
          <div className="field"><label htmlFor="password">密码</label><input id="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 15 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></div>
          {mode === "register" && <div className="field"><label htmlFor="confirm">确认密码</label><input id="confirm" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} /></div>}
          {mode === "register" && <label className="checkline"><input type="checkbox" required checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)} /><span>我确认自己已满 18 岁。</span></label>}
          {mode === "register" && <p className="hint">使用至少 15 位密码。当前没有邮箱和密码找回功能，请妥善保存密码。注册表示你已阅读<a href="/privacy">资料与隐私说明</a>及<a href="/terms">使用规则</a>。</p>}
          <button className="primary-btn" type="submit" disabled={busy}>{busy ? "请稍候…" : mode === "register" ? "创建账号" : "登录"}</button>
        </form>
      </div> : <div className="account-sections">
        <section className="card account-card"><h2>账号操作</h2><p className="muted small">你可以在这里退出登录。交友资料可在首页编辑或删除。</p><div className="candidate-actions"><a className="primary-btn" href="/">返回匹配</a><button className="secondary-btn" type="button" onClick={() => void logout()} disabled={busy}>退出登录</button></div></section>
        <section className="card account-card"><h2>修改密码</h2><form onSubmit={changePassword}><div className="field"><label htmlFor="current-password">当前密码</label><input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></div><div className="field"><label htmlFor="new-password">新密码</label><input id="new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></div><button className="secondary-btn" type="submit" disabled={busy}>修改密码</button></form></section>
        <section className="card account-card"><h2>永久删除账号</h2><p className="muted small">账号、资料、心动、屏蔽记录和登录会话都会删除，无法恢复。请输入密码确认。</p><form onSubmit={deleteAccount}><div className="field"><label htmlFor="delete-password">当前密码</label><input id="delete-password" type="password" autoComplete="current-password" required value={deletePassword} onChange={e => setDeletePassword(e.target.value)} /></div><button className="secondary-btn danger-btn" type="submit" disabled={busy}>永久删除账号与资料</button></form></section>
      </div>}
    </main>
  </div>;
}
