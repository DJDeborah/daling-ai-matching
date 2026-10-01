"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { DraftProfile, Gender } from "@/lib/profile";

type Conversation = {
  turn: number;
  step: number;
  status: "collecting" | "review" | "complete";
  draft: DraftProfile;
  messages: { role: "assistant" | "user"; content: string }[];
  question: string;
  totalSteps: number;
};

type Candidate = {
  id: string;
  source: "demo" | "real";
  name: string;
  age: number;
  city: string;
  interests: string[];
  reasons: string[];
  about: string;
  rank: number;
  narrative: string | null;
};

type Report = {
  mode: "rules" | "ai";
  generatedAt: string;
  profileUpdatedAt: string;
  summary: string;
  demoPoolSize: number;
  demoEligibleCount: number;
  demoCandidates: Candidate[];
  realStatus: "available" | "private";
  realEligibleCount: number;
  realCandidates: Candidate[];
  note: string;
};

type ReportResponse = { report: Report; aiAvailable: boolean };

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "请求失败，请稍后再试");
  return data;
}

const genderText: Record<Gender | "any", string> = { man: "男", woman: "女", nonbinary: "非二元", any: "不限" };

function CandidateCard({ candidate }: { candidate: Candidate }) {
  return <article className="chat-candidate card">
    <div className="candidate-top"><span className="avatar" aria-hidden="true">{candidate.name.slice(0, 1)}</span><div><h3>{candidate.name} · {candidate.age} 岁</h3><span className="muted small">{candidate.city}</span></div></div>
    {candidate.about && <p>{candidate.about}</p>}
    <div className="tags">{candidate.reasons.map(reason => <span className="tag" key={reason}>{reason}</span>)}</div>
    {candidate.narrative && <p className="match-narrative">{candidate.narrative}</p>}
    {candidate.interests.length > 0 && <p className="small muted">兴趣：{candidate.interests.join(" · ")}</p>}
    {candidate.source === "demo" && <span className="demo-label">虚构样例 · 无法联系</span>}
  </article>;
}

export default function ChatApp({ username }: { username: string }) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [answer, setAnswer] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [reportConsent, setReportConsent] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [poolConsent, setPoolConsent] = useState(false);
  const [visible, setVisible] = useState(false);
  const [contactShare, setContactShare] = useState(false);
  const [contactKind, setContactKind] = useState<"wechat" | "telegram" | "email" | "other">("wechat");
  const [contactValue, setContactValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void apiJson<Conversation>("/api/conversation").then(async state => {
      setConversation(state);
      if (state.status === "complete") {
        const result = await apiJson<ReportResponse>("/api/report");
        setReport(result.report); setAiAvailable(result.aiAvailable);
      }
    }).catch(e => setError(e instanceof Error ? e.message : "加载失败")).finally(() => setLoading(false));
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [conversation?.turn, conversation?.status]);

  async function sendAnswer(event: FormEvent) {
    event.preventDefault();
    if (!conversation || conversation.status !== "collecting" || !answer.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await apiJson<Conversation>("/api/conversation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: answer.trim(), turn: conversation.turn }),
      });
      setConversation(next); setAnswer("");
    } catch (e) { setError(e instanceof Error ? e.message : "发送失败"); }
    finally { setBusy(false); }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!conversation || conversation.status !== "review" || busy) return;
    if (!adultConfirmed || !poolConsent) return setError("请确认年龄并同意保存及使用资料");
    if (contactShare && !contactValue.trim()) return setError("填写联系方式后才能授权分享");
    setBusy(true); setError("");
    try {
      const next = await apiJson<Conversation>("/api/conversation", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adultConfirmed, poolConsent, visible, contactKind, contactValue: contactValue.trim(), contactShare }),
      });
      setConversation(next);
      const result = await apiJson<ReportResponse>("/api/report");
      setReport(result.report); setAiAvailable(result.aiAvailable);
      setNotice("资料已保存，匹配报告已生成。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function generateAiReport() {
    if (!reportConsent || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiJson<ReportResponse>("/api/report", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }),
      });
      setReport(result.report); setAiAvailable(result.aiAvailable);
      setNotice(result.report.mode === "ai" ? "AI 已补充文字解读；匹配资格和排序仍按已确认条件计算。" : "已显示规则匹配报告。AI 暂时不可用。 ");
    } catch (e) { setError(e instanceof Error ? e.message : "AI 报告暂时无法生成"); }
    finally { setBusy(false); }
  }

  async function restart() {
    if (busy || !window.confirm("重新开始对话？当前对话记录会删除。已保存的交友资料可在“我的资料”管理。")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await apiJson<Conversation>("/api/conversation", { method: "DELETE" });
      setConversation(next); setReport(null); setReportConsent(false); setAdultConfirmed(false); setPoolConsent(false);
      setVisible(false); setContactShare(false); setContactValue("");
    } catch (e) { setError(e instanceof Error ? e.message : "重置失败"); }
    finally { setBusy(false); }
  }

  const d = conversation?.draft;
  return <div className="chat-shell">
    <header className="topbar chat-topbar"><Link className="brand" href="/"><span className="brand-mark">✳</span>妲灵</Link><span className="topbar-note">对话认识 · 双向匹配</span><nav className="chat-nav"><a href="/profile">我的资料与真实匹配</a><a href="/account">{username} · 账号</a></nav></header>
    <main className="chat-main">
      <div className="chat-heading"><div><p className="section-kicker">DALING · AI MATCHING</p><h1>{conversation?.status === "complete" ? "你的匹配报告" : conversation?.status === "review" ? "核对你的资料" : "从一场对话开始"}</h1><p>{conversation?.status === "complete" ? "根据你确认的资料进行双向条件筛选，结果随资料更新。" : "你可以像聊天一样回答。AI 会一次问一个问题，需要时会继续追问。"}</p></div><div className="chat-heading-mark" aria-hidden="true">✳</div></div>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {loading && <section className="card chat-panel chat-loading">正在加载对话…</section>}
      {!loading && conversation && conversation.status !== "complete" && <div className="chat-layout">
        <section className="card chat-panel" aria-label="匹配对话">
          <div className="chat-panel-head"><div><span className="chat-live-dot"/>妲灵匹配助手</div><span>{conversation.status === "review" ? "资料核对" : `话题 ${Math.min(conversation.step + 1, conversation.totalSteps)} / ${conversation.totalSteps}`}</span></div>
          <div className="chat-thread" aria-live="polite">
            {conversation.messages.map((message, index) => <div className={`chat-line ${message.role}`} key={`${index}-${message.role}`}><span className="chat-bubble">{message.content}</span></div>)}
            {busy && conversation.status === "collecting" && <div className="chat-line assistant"><span className="chat-bubble chat-thinking">正在理解你的回答…</span></div>}
            <div ref={bottomRef}/>
          </div>
          {conversation.status === "collecting" ? <form className="chat-composer" onSubmit={sendAnswer}><label className="sr-only" htmlFor="chat-answer">你的回答</label><textarea id="chat-answer" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="在这里回答，或输入“跳过”略过可选话题…" maxLength={400} rows={2} disabled={busy}/><div className="chat-composer-foot"><span>请勿发送电话、微信号等联系方式</span><button className="primary-btn" type="submit" disabled={busy || !answer.trim()}>{busy ? "稍候…" : "发送回答 ↗"}</button></div></form> : <div className="chat-composer"><span className="muted small">对话已完成。请在右侧核对资料和授权。</span></div>}
        </section>
        <aside className="chat-side">
          {conversation.status === "collecting" ? <div className="card chat-side-card"><span className="status">逐题进行</span><h2>只问眼前这一题</h2><p>上方问题是引导。你可以自然表达，助手会理解并追问不清楚的部分。</p><div className="chat-progress-track"><span style={{ width: `${Math.round(100 * conversation.step / conversation.totalSteps)}%` }}/></div><p className="small muted">完成后会先给你核对资料，再生成匹配报告。</p></div> : <div className="card chat-side-card review-card"><span className="status">保存前核对</span><h2>你刚才告诉我们的</h2>{d && <div className="review-summary"><p><strong>称呼</strong><span>{d.name}</span></p><p><strong>基本信息</strong><span>{genderText[d.gender]} · {d.age} 岁 · {d.city}</span></p><p><strong>想认识</strong><span>{genderText[d.seeking]} · {d.minAge}–{d.maxAge} 岁{d.preferredCity ? ` · ${d.preferredCity}` : ""}</span></p>{d.heightCm && <p><strong>身高</strong><span>{d.heightCm} cm</span></p>}{d.interests.length > 0 && <p><strong>兴趣</strong><span>{d.interests.join("、")}</span></p>}{d.about && <p><strong>自我介绍</strong><span>{d.about}</span></p>}{d.partnerNote && <p><strong>期待</strong><span>{d.partnerNote}</span></p>}</div>}
          <form onSubmit={saveProfile} className="review-form"><label className="checkline"><input type="checkbox" checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)}/><span>我确认已满 18 岁。</span></label><label className="checkline"><input type="checkbox" checked={poolConsent} onChange={e => setPoolConsent(e.target.checked)}/><span>我已阅读<a href="/privacy" target="_blank">资料与隐私说明</a>，同意保存资料并用于匹配报告。</span></label><label className="checkline"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)}/><span>将资料加入真实用户匹配池，让符合双向条件的人看到我的公开资料。</span></label><div className="field"><label htmlFor="contact-kind">联系方式（可选，不发送给 AI）</label><select id="contact-kind" value={contactKind} onChange={e => setContactKind(e.target.value as typeof contactKind)}><option value="wechat">微信</option><option value="telegram">Telegram</option><option value="email">邮箱</option><option value="other">其他</option></select><input aria-label="联系方式" value={contactValue} onChange={e => setContactValue(e.target.value)} maxLength={100} placeholder="仅双向心动且双方授权后可见"/></div><label className="checkline"><input type="checkbox" checked={contactShare} onChange={e => setContactShare(e.target.checked)}/><span>双方心动且都同意分享时，向对方显示上面的联系方式。</span></label><button className="primary-btn" type="submit" disabled={busy || !adultConfirmed || !poolConsent}>{busy ? "正在保存…" : "确认资料并生成报告"}</button></form><button className="chat-text-button" type="button" onClick={() => void restart()} disabled={busy}>想更正资料？重新对话</button></div>}
        </aside>
      </div>}
      {!loading && conversation?.status === "complete" && <section className="report-wrap">
        {report ? <><div className="report-intro card"><span className="status">{report.mode === "ai" ? "规则匹配 + AI 解读" : "规则匹配"}</span><h2>匹配概览</h2><p>{report.summary}</p><div className="report-metrics"><div><strong>{report.demoPoolSize}</strong><span>虚构样例总数</span></div><div><strong>{report.demoEligibleCount}</strong><span>符合双向条件的样例</span></div><div><strong>{report.realEligibleCount}</strong><span>当前真实候选</span></div></div><p className="small muted">{report.note}</p></div><div className="report-section-title"><div><p className="section-kicker">EXAMPLE MATCHES</p><h2>样例匹配</h2><p>以下资料全部是虚构演示数据，用来展示匹配方法，不能心动或联系。</p></div></div>{report.demoCandidates.length ? <div className="report-grid">{report.demoCandidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate}/>)}</div> : <div className="card report-empty"><h3>当前条件下，样例池没有符合双向条件的人</h3><p>这表示演示池范围有限，并不代表现实中没有合适的人。可在“我的资料”调整确认过的偏好。</p></div>}<div className="report-section-title"><div><p className="section-kicker">REAL MEMBERS</p><h2>真实报名者</h2><p>{report.realStatus === "private" ? "你尚未加入真实匹配池。开启公开后才会看到符合双方条件的真实资料。" : "这里仅展示已同意公开且双方条件相符的站内用户。"}</p></div><a className="secondary-btn" href="/profile">管理资料与真实匹配</a></div>{report.realStatus === "available" && (report.realCandidates.length ? <div className="report-grid">{report.realCandidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate}/>)}</div> : <div className="card report-empty"><h3>暂时没有符合条件的真实报名者</h3><p>真实用户池不会用虚构资料填充。你可以稍后再查看。</p></div>)}<div className="card report-ai"><div><h2>进一步解读</h2><p>可让 AI 用更自然的语言解释样例匹配。只发送精简偏好和虚构样例特征；资格与排序由规则决定。</p></div><label className="checkline"><input type="checkbox" checked={reportConsent} onChange={e => setReportConsent(e.target.checked)}/><span>我同意本次将精简匹配偏好发送给 DeepSeek 生成解读。</span></label><button className="secondary-btn" type="button" disabled={busy || !reportConsent || !aiAvailable} onClick={() => void generateAiReport()}>{busy ? "生成中…" : report.mode === "ai" ? "重新生成 AI 解读" : "生成 AI 解读"}</button>{!aiAvailable && <p className="small muted">AI 服务暂不可用，规则报告仍可使用。</p>}</div></> : <div className="card report-empty"><h3>报告暂时无法加载</h3><p>资料已保存，可以刷新页面重试。</p></div>}
      </section>}
      {!loading && conversation && <div className="chat-footer"><button className="chat-text-button" type="button" disabled={busy} onClick={() => void restart()}>重新开始对话</button><span>·</span><a href="/privacy">隐私说明</a><span>·</span><a href="/terms">使用规则</a></div>}
    </main>
  </div>;
}
