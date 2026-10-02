"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { DraftProfile, Gender } from "@/lib/profile";
import type { MatchReport, ReportCandidate } from "@/lib/report";
import { depthKeys, depthLabels } from "@/lib/depth";
import { MotionScope, Reveal, ConnectionVisual } from "./design-motion";
import { motion, useReducedMotion } from "motion/react";

type Conversation = {
  turn: number;
  step: number;
  status: "collecting" | "review" | "complete";
  draft: DraftProfile;
  messages: { role: "assistant" | "user"; content: string }[];
  question: string;
  totalSteps: number;
  topic: string;
  phase: "basics" | "depth" | "review";
  revision: string;
  inputLimit: number;
};

type Candidate = ReportCandidate;
type Report = MatchReport;

type ReportResponse = { report: Report; aiAvailable: boolean };

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "请求失败，请稍后再试");
  return data;
}

const genderText: Record<Gender | "any", string> = { man: "男", woman: "女", nonbinary: "非二元", any: "不限" };

function CandidateCard({ candidate }: { candidate: Candidate }) {
  return <Reveal className="chat-candidate card">
    <div className="candidate-top"><span className="candidate-index">{String(candidate.rank).padStart(2,"0")}</span><div><h3>{candidate.name}</h3><span className="muted small">{candidate.age} 岁 · {candidate.city}</span></div><div className="match-score"><strong>{candidate.overallScore ?? "—"}</strong><span>{candidate.overallScore === null ? "深度资料待了解" : "资料相符度"}</span></div></div>
    {candidate.about && <p>{candidate.about}</p>}
    <div className="tags">{candidate.reasons.map(reason => <span className="tag" key={reason}>{reason}</span>)}</div>
    <div className="depth-score-caption"><span>深度比较覆盖度</span><strong>{candidate.compatibility.coverage}%</strong></div><div className="coverage-track"><span style={{width:`${candidate.compatibility.coverage}%`}}/></div>
    <details className="match-details"><summary>查看六个维度与讨论建议</summary><div className="dimension-list">{candidate.compatibility.dimensions.map(item=><div className="dimension" key={item.key}><div><span>{item.label}</span><strong>{item.score === null ? "待了解" : `${item.score} / 100`}</strong></div><div className="dimension-track"><span style={{width:`${item.score ?? 0}%`}}/></div><p>{item.evidence}</p></div>)}</div>{candidate.compatibility.discussions.length>0 && <div className="discussion-box"><h4>值得继续聊</h4>{candidate.compatibility.discussions.map(question=><p key={question}>{question}</p>)}</div>}</details>
    {candidate.narrative && <p className="match-narrative">{candidate.narrative}</p>}
    {candidate.interests.length > 0 && <p className="small muted">兴趣：{candidate.interests.join(" · ")}</p>}
    {candidate.source === "demo" && <span className="demo-label">虚构样例 · 无法联系</span>}
  </Reveal>;
}

function DepthSummaries({ draft }: { draft: DraftProfile }) {
  return <div className="depth-summary-grid">{depthKeys.map(key=>{const topic=draft.depth.topics[key];return <div className="depth-summary" key={key}><span>{depthLabels[key]}</span><p>{topic?.status === "answered" ? topic.summary : "暂未填写，保持为未知"}</p>{topic?.status === "answered" && <details><summary>查看我的原回答</summary><p>{topic.answer}</p></details>}</div>;})}</div>;
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
  const [resumed, setResumed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    void apiJson<Conversation>("/api/conversation").then(async state => {
      setConversation(state);
      setResumed(state.turn > 0);
      if (state.status === "complete") {
        const result = await apiJson<ReportResponse>("/api/report");
        setReport(result.report); setAiAvailable(result.aiAvailable);
      }
    }).catch(e => setError(e instanceof Error ? e.message : "加载失败")).finally(() => setLoading(false));
  }, []);

  useEffect(() => { const thread=bottomRef.current?.parentElement; thread?.scrollTo({top:thread.scrollHeight,behavior:reduceMotion ? "instant" : "smooth"}); }, [conversation?.turn, conversation?.status, busy, reduceMotion]);

  async function sendAnswer(event: FormEvent) {
    event.preventDefault();
    if (!conversation || conversation.status !== "collecting" || !answer.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await apiJson<Conversation>("/api/conversation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: answer.trim(), turn: conversation.turn, revision:conversation.revision }),
      });
      setConversation(next); setAnswer(""); setResumed(false);
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
        body: JSON.stringify({ adultConfirmed, poolConsent, visible, contactKind, contactValue: contactValue.trim(), contactShare, turn:conversation.turn, revision:conversation.revision }),
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
      const next = await apiJson<Conversation>("/api/conversation", { method: "DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({turn:conversation?.turn,revision:conversation?.revision}) });
      setConversation(next); setReport(null); setReportConsent(false); setAdultConfirmed(false); setPoolConsent(false);
      setAnswer(""); setResumed(false);
      setVisible(false); setContactShare(false); setContactValue("");
    } catch (e) { setError(e instanceof Error ? e.message : "重置失败"); }
    finally { setBusy(false); }
  }

  async function deepen() {
    if (!conversation || busy) return;
    setBusy(true);setError("");setNotice("");
    try {
      const next=await apiJson<Conversation>("/api/conversation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({turn:conversation.turn,revision:conversation.revision})});
      setConversation(next);setReport(null);setAnswer("");setResumed(false);setAdultConfirmed(false);setPoolConsent(false);setReportConsent(false);setVisible(false);setContactShare(false);setContactValue("");
    } catch(e) {setError(e instanceof Error ? e.message : "暂时无法开始");}
    finally {setBusy(false);}
  }

  const d = conversation?.draft;
  return <MotionScope><div className="chat-shell">
    <header className="topbar chat-topbar"><Link className="brand" href="/"><span className="brand-mark">d.</span>妲灵<span className="brand-en">DALING</span></Link><span className="topbar-note">A LITTLE DEEPER, A LITTLE CLOSER.</span><nav className="chat-nav"><a href="/profile">我的资料</a><a href="/account">{username}</a></nav></header>
    <main className="chat-main">
      <div className="chat-heading"><div><p className="section-kicker">DALING · AI MATCHING</p><h1>{conversation?.status === "complete" ? "找到相符的细节。" : conversation?.status === "review" ? "这是你的样子。" : conversation?.phase === "depth" ? "聊聊关系里的你。" : "了解你，从细节开始。"}</h1><p>{conversation?.status === "complete" ? "共同点、差异和还值得聊的问题，都有依据。" : "妲灵会沿着你的回答继续聊。不用准备标准答案。"}</p></div><div className="chat-heading-mark" aria-hidden="true">{conversation?.status === "complete" ? "03" : conversation?.phase === "depth" || conversation?.status === "review" ? "02" : "01"}</div></div>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {loading && <section className="card chat-panel chat-loading">正在加载对话…</section>}
      {!loading && conversation && (resumed || conversation.status === "complete") && <section className="conversation-resume" aria-label="继续或开启对话"><div><strong>{conversation.status === "complete" ? resumed ? "已恢复上次的档案与报告" : "档案已保存，可以继续聊" : "继续上次的对话"}</strong><p>{conversation.status === "collecting" ? "进度已保存。发送新的回答，妲灵会结合之前的内容继续回应。" : conversation.status === "review" ? "上次已经聊完，可以核对资料并生成报告，也可以重新开始。" : "可以继续和妲灵聊深度问题，或从第一题开启新对话。"}</p></div><div className="conversation-resume-actions">{conversation.status === "complete" && <button className="primary-btn" type="button" disabled={busy} onClick={() => void deepen()}>继续深度对话</button>}<button className="secondary-btn" type="button" disabled={busy} onClick={() => void restart()}>开启新对话</button></div></section>}
      {!loading && conversation && conversation.status !== "complete" && <div className="chat-layout">
        <section className="card chat-panel" aria-label="匹配对话">
          <div className="chat-panel-head"><div><span className="chat-live-dot"/>妲灵 · DALING AI</div><span>{conversation.status === "review" ? "资料核对" : `${conversation.phase === "depth" ? "深度相处" : "初步了解"} · ${Math.min(conversation.step + 1, conversation.totalSteps)} / ${conversation.totalSteps}`}</span></div>
          <div className="chat-thread" aria-live="polite">
            {conversation.messages.map((message, index) => <motion.div className={`chat-line ${message.role}`} key={`${index}-${message.role}`} initial={reduceMotion ? false : {opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.3}}><span className="chat-bubble">{message.content}</span></motion.div>)}
            {busy && conversation.status === "collecting" && <div className="chat-line assistant"><span className="chat-bubble chat-thinking">妲灵正在回应…</span></div>}
            <div ref={bottomRef}/>
          </div>
          {conversation.status === "collecting" ? <form className="chat-composer" onSubmit={sendAnswer}><label className="sr-only" htmlFor="chat-answer">你的回答</label><textarea id="chat-answer" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="在这里回答，或输入“跳过”略过可选话题…" maxLength={conversation.inputLimit} rows={2} disabled={busy}/><div className="chat-composer-foot"><span>联系方式请在最后单独设置 · {answer.length}/{conversation.inputLimit}</span><button className="primary-btn" type="submit" disabled={busy || !answer.trim()}>{busy ? "稍候…" : "发送"}</button></div></form> : <div className="chat-composer"><span className="muted small">对话已完成。请在右侧核对资料和授权。</span></div>}
        </section>
        <aside className="chat-side">
          {conversation.status === "collecting" ? <div className="chat-side-card"><p className="section-kicker">YOUR JOURNEY</p><ol className="journey-list"><li className={conversation.phase === "basics" ? "current" : "done"}><span>01</span><div><strong>认识你</strong><p>生活、兴趣与基本偏好</p></div></li><li className={conversation.phase === "depth" ? "current" : ""}><span>02</span><div><strong>理解相处</strong><p>价值观、支持、节奏与边界</p></div></li><li><span>03</span><div><strong>寻找相符</strong><p>核对档案，阅读匹配报告</p></div></li></ol><div className="chat-progress-track"><span style={{width:Math.round(100*conversation.step/conversation.totalSteps)+"%"}}/></div><div className="depth-score-caption"><span>已经聊过的话题</span><strong>{conversation.step}/{conversation.totalSteps}</strong></div><ConnectionVisual compact/><p className="journey-note">可以慢慢聊，可选问题都能跳过。每一项理解，最后会先交给你核对。</p></div> : <div className="card chat-side-card review-card"><span className="status">保存前核对</span><h2>你刚才告诉我们的</h2>{d && <div className="review-summary"><p><strong>称呼</strong><span>{d.name}</span></p><p><strong>基本信息</strong><span>{genderText[d.gender]} · {d.age} 岁 · {d.city}</span></p><p><strong>想认识</strong><span>{genderText[d.seeking]} · {d.minAge}–{d.maxAge} 岁{d.preferredCity ? ` · ${d.preferredCity}` : ""}</span></p>{d.heightCm && <p><strong>身高</strong><span>{d.heightCm} cm</span></p>}{d.interests.length > 0 && <p><strong>兴趣</strong><span>{d.interests.join("、")}</span></p>}{d.about && <p><strong>自我介绍</strong><span>{d.about}</span></p>}{d.partnerNote && <p><strong>期待</strong><span>{d.partnerNote}</span></p>}</div>}
          {d && <DepthSummaries draft={d}/>}<button className="secondary-btn" type="button" disabled={busy} onClick={() => void deepen()}>重新聊深度问题</button><form onSubmit={saveProfile} className="review-form"><label className="checkline"><input type="checkbox" checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)}/><span>我确认已满 18 岁。</span></label><label className="checkline"><input type="checkbox" checked={poolConsent} onChange={e => setPoolConsent(e.target.checked)}/><span>我已阅读<a href="/privacy" target="_blank">资料与隐私说明</a>，我核对了基础与深度档案，同意保存并用于匹配报告。</span></label><label className="checkline"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)}/><span>加入真实匹配池，公开基础资料并比较深度档案。原始对话与完整 JSON 不向其他用户展示。</span></label><div className="field"><label htmlFor="contact-kind">联系方式（可选，不发送给 AI）</label><select id="contact-kind" value={contactKind} onChange={e => setContactKind(e.target.value as typeof contactKind)}><option value="wechat">微信</option><option value="telegram">Telegram</option><option value="email">邮箱</option><option value="other">其他</option></select><input aria-label="联系方式" value={contactValue} onChange={e => setContactValue(e.target.value)} maxLength={100} placeholder="仅双向心动且双方授权后可见"/></div><label className="checkline"><input type="checkbox" checked={contactShare} onChange={e => setContactShare(e.target.checked)}/><span>双方心动且都同意分享时，向对方显示上面的联系方式。</span></label><button className="primary-btn" type="submit" disabled={busy || !adultConfirmed || !poolConsent}>{busy ? "正在保存…" : "确认资料并生成报告"}</button></form><button className="chat-text-button" type="button" onClick={() => void restart()} disabled={busy}>想更正资料？重新对话</button></div>}
        </aside>
      </div>}
      {!loading && conversation?.status === "complete" && <section className="report-wrap">{report && <><div className="report-section-title"><div><p className="section-kicker">YOUR CONNECTION PROFILE</p><h2>已确认的深度档案</h2><p>{report.myDepth.answered}/{report.myDepth.total} 个深度主题已填写</p></div><div className="report-actions"><a className="secondary-btn" href="/api/profile/export">下载我的 JSON 档案</a><button className="secondary-btn" type="button" onClick={()=>void deepen()} disabled={busy}>补充或重聊深度问题</button></div></div><div className="depth-summary-grid">{report.myDepth.summaries.map(item=><Reveal className="depth-summary" key={item.label}><span>{item.label}</span><p>{item.summary}</p></Reveal>)}</div>{report.myDepth.unanswered.length>0 && <p className="small muted">暂未填写：{report.myDepth.unanswered.join("、")}。这些信息保持未知，不会被当成不相符。</p>}</>}
        {report ? <><div className="report-intro card"><span className="status">{report.mode === "ai" ? "规则匹配 + AI 解读" : "规则匹配"}</span><h2>匹配概览</h2><p>{report.summary}</p><div className="report-metrics"><div><strong>{report.demoPoolSize}</strong><span>虚构样例总数</span></div><div><strong>{report.demoEligibleCount}</strong><span>符合双向条件的样例</span></div><div><strong>{report.realEligibleCount}</strong><span>当前真实候选</span></div></div><p className="small muted">{report.note}</p></div><div className="report-section-title"><div><p className="section-kicker">EXAMPLE CONNECTIONS</p><h2>深度匹配样例</h2><p>以下资料全部是虚构演示数据，用来展示匹配方法，不能心动或联系。</p></div></div>{report.demoCandidates.length ? <div className="report-grid">{report.demoCandidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate}/>)}</div> : <div className="card report-empty"><h3>当前条件下，样例池没有符合双向条件的人</h3><p>这表示演示池范围有限，并不代表现实中没有合适的人。可在“我的资料”调整确认过的偏好。</p></div>}<div className="report-section-title"><div><p className="section-kicker">REAL MEMBERS</p><h2>真实报名者</h2><p>{report.realStatus === "private" ? "你尚未加入真实匹配池。开启公开后才会看到符合双方条件的真实资料。" : "这里仅展示已同意公开且双方条件相符的站内用户。"}</p></div><a className="secondary-btn" href="/profile">管理资料与真实匹配</a></div>{report.realStatus === "available" && (report.realCandidates.length ? <div className="report-grid">{report.realCandidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate}/>)}</div> : <div className="card report-empty"><h3>暂时没有符合条件的真实报名者</h3><p>真实用户池不会用虚构资料填充。你可以稍后再查看。</p></div>)}<div className="card report-ai"><div><h2>进一步解读</h2><p>根据已有证据解释样例的相符点和可讨论之处。会发送你的兴趣、期待、深度摘要及虚构样例的比较结果。</p></div><label className="checkline"><input type="checkbox" checked={reportConsent} onChange={e => setReportConsent(e.target.checked)}/><span>我同意本次将上述精简资料发送给 DeepSeek 生成解读。</span></label><button className="secondary-btn" type="button" disabled={busy || !reportConsent || !aiAvailable} onClick={() => void generateAiReport()}>{busy ? "生成中…" : report.mode === "ai" ? "重新生成 AI 解读" : "生成 AI 解读"}</button>{!aiAvailable && <p className="small muted">AI 服务暂不可用，规则报告仍可使用。</p>}</div></> : <div className="card report-empty"><h3>报告暂时无法加载</h3><p>资料已保存，可以刷新页面重试。</p></div>}
      </section>}
      {!loading && conversation && <div className="chat-footer"><button className="chat-text-button" type="button" disabled={busy} onClick={() => void restart()}>重新开始对话</button><span>·</span><a href="/privacy">隐私说明</a><span>·</span><a href="/terms">使用规则</a></div>}
    </main>
  </div></MotionScope>;
}
