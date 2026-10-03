"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Download, Link2, Search, Send, Sparkles, LoaderCircle, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { ConversationView } from "@/lib/conversation";
import type { MatchReport, ReportCandidate } from "@/lib/report";
import { depthKeys, depthLabels } from "@/lib/depth";
import { MatchSearchTransition, MotionScope } from "./design-motion";

type Screen = "chat" | "review" | "searching" | "report";
type ReportResponse = { report: MatchReport; aiAvailable: boolean; aiStatus: "not_requested" | "generated" | "cached" | "fallback" | "unavailable" | "limit_reached" };
const genderText: Record<string, string> = { woman: "女", man: "男", nonbinary: "非二元", any: "不限" };
async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", credentials: "same-origin" });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "暂时无法完成，请重试");
  return result;
}
function jsonBody(body: unknown, method = "POST"): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
function CandidateCard({ candidate }: { candidate: ReportCandidate }) {
  return <article className="match-card">
    <div className="match-card-top"><span className="candidate-monogram" aria-hidden="true">{candidate.name.slice(0, 1)}</span><div><h3><span className="candidate-rank">{String(candidate.rank).padStart(2, "0")}</span>{candidate.name}</h3><p>{candidate.age} 岁 · {candidate.city}</p></div><span className="candidate-kind">{candidate.source === "demo" ? "体验候选" : "报名者"}</span></div>
    <p className="candidate-about">{candidate.about}</p><div className="interest-tags">{candidate.interests.map(interest => <span key={interest}>{interest}</span>)}</div>
    <div className="match-evidence"><h4><Link2 size={15}/>相符的细节</h4><ul>{candidate.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
    {candidate.overallScore !== null && <p className="score-caption">{candidate.eligibility === "approximate" ? "已知相处维度" : "相符参考指数"} <strong>{candidate.overallScore}</strong><span> / 100 · 已知资料</span></p>}
    {candidate.eligibility === "approximate" && <div className="candidate-gaps"><strong>相对最接近 · 条件仍有差距</strong><ul>{candidate.unmetConditions.map(item=><li key={item}>{item}</li>)}</ul></div>}
    {candidate.unknownConditions.length > 0 && <p className="candidate-unknown">待确认：{candidate.unknownConditions.join("；")}。</p>}
    {candidate.eligibility === "provisional" && <p className="small muted">基础条件待补充，暂不确认双向资格。</p>}
    {candidate.narrative && <p className="candidate-narrative"><Sparkles size={15}/>{candidate.narrative}</p>}
    <details className="candidate-details"><summary>展开相处维度</summary><div className="dimension-list">{candidate.compatibility.dimensions.map(dimension => <div key={dimension.key}><strong>{dimension.label}</strong><span>{dimension.score === null ? "待了解" : `${dimension.score} / 100`}</span><p>{dimension.evidence}</p></div>)}</div>{candidate.compatibility.discussions.map(question => <p className="discussion-question" key={question}>{question}</p>)}</details>
  </article>;
}

function MatchingAnalysis({ report }: { report: MatchReport }) {
  const first = report.demoCandidates[0] ?? report.realCandidates[0];
  const known = first?.compatibility.dimensions.filter(item => item.score !== null) ?? [];
  const aligned = known.filter(item => item.score! >= 75);
  const discussions = known.filter(item => item.score! < 75).map(item => item.discussion).filter((item): item is string => Boolean(item)).slice(0, 3);
  return <div className="matching-analysis-grid">
    <article><h3>分析依据</h3><p>已聊 {report.answeredTopics} / {report.totalTopics} 个话题，其中 {report.myDepth.answered} 个深度主题。{report.missingBasics.length ? `基本条件待了解：${report.missingBasics.join("、")}。` : "基本条件已确认。"}</p><p>未回答的信息保持待了解，不计为不相符。</p></article>
    <article><h3>{first ? "为什么先了解这一位" : "当前筛选结果"}</h3>{first ? <><p>{first.eligibility === "approximate" ? "相对最接近的参考对象是" : "目前优先推荐的是"}{first.name}，依据是{first.reasons.join("、")}。</p><p>{aligned.length ? `已知的相处共同点：${aligned.map(item => item.label).join("、")}。` : "双方深度资料还不足以确认相处共同点，可以从具体经历开始聊。"}</p>{first.unmetConditions.length > 0 && <p className="candidate-unknown">仍有差距：{first.unmetConditions.join("；")}。</p>}</> : <p>目前还没有可比较的档案。</p>}</article>
    <article><h3>接下来值得聊</h3>{discussions.length ? <ul>{discussions.map(item => <li key={item}>{item}</li>)}</ul> : <p>{report.myDepth.unanswered.length ? `还可以补充：${report.myDepth.unanswered.join("、")}。` : "可以用一次真实分歧、需要支持的时刻和未来生活安排，确认对方是否与你有相近的期待。"}</p>}</article>
  </div>;
}

export default function ChatApp({ username }: { username: string }) {
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [screen, setScreen] = useState<Screen>("chat");
  const [answer, setAnswer] = useState("");
  const [pendingAnswer, setPendingAnswer] = useState("");
  const [report, setReport] = useState<MatchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiConsent, setAiConsent] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [poolConsent, setPoolConsent] = useState(false);
  const [visible, setVisible] = useState(false);
  const [contactShare, setContactShare] = useState(false);
  const [contactKind, setContactKind] = useState<"wechat" | "telegram" | "email" | "other">("wechat");
  const [contactValue, setContactValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const reportEpoch = useRef(0);
  const reduceMotion = useReducedMotion();

  async function loadReport(animate = true) {
    const epoch = ++reportEpoch.current;
    setReportLoading(true);
    setError(""); setReport(null); setAiMessage(""); setAiError(""); setScreen(animate ? "searching" : "report");
    try {
      const [result] = await Promise.all([apiJson<ReportResponse>("/api/report"), new Promise(resolve => setTimeout(resolve, animate && !reduceMotion ? 1100 : 0))]);
      if (epoch !== reportEpoch.current) return;
      setReport(result.report);
      if (result.aiStatus === "cached") setAiMessage("已恢复这份资料的 AI 解读。");
    } catch (e) { if (epoch === reportEpoch.current) setError(e instanceof Error ? e.message : "报告加载失败"); }
    finally { if (epoch === reportEpoch.current) { setScreen("report"); setReportLoading(false); } }
  }
  useEffect(() => {
    void apiJson<ConversationView>("/api/conversation").then(async state => {
      setConversation(state);
      if (state.status === "complete" || state.status === "paused") await loadReport(false);
      else setScreen(state.status === "review" ? "review" : "chat");
    }).catch(e => setError(e instanceof Error ? e.message : "对话加载失败")).finally(() => setLoading(false));
    // Initial restoration runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const thread = bottomRef.current?.parentElement; thread?.scrollTo({ top: thread.scrollHeight, behavior: reduceMotion ? "instant" : "smooth" }); }, [conversation?.turn, pendingAnswer, screen, reduceMotion]);

  async function sendAnswer(event: FormEvent) {
    event.preventDefault();
    if (!conversation || conversation.status !== "collecting" || !answer.trim() || busy) return;
    setBusy(true); setPendingAnswer(answer.trim()); setError("");
    try {
      const next = await apiJson<ConversationView>("/api/conversation", jsonBody({ message: answer.trim(), turn: conversation.turn, revision: conversation.revision }));
      setConversation(next); setAnswer("");
      if (next.status === "review") setScreen("review");
    } catch (e) { setError(e instanceof Error ? e.message : "发送失败，请重试"); }
    finally { setBusy(false); setPendingAnswer(""); }
  }
  async function transition(action: "pause" | "resume" | "review") {
    if (!conversation || busy || aiBusy || reportLoading) return;
    setBusy(true); setError("");
    try {
      const next = await apiJson<ConversationView>("/api/conversation/transition", jsonBody({ action, turn: conversation.turn, revision: conversation.revision }));
      setConversation(next);
      if (action === "pause") await loadReport();
      else setScreen(next.status === "review" ? "review" : "chat");
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法切换，请重试"); }
    finally { setBusy(false); }
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!conversation || busy) return;
    if (!adultConfirmed || !poolConsent) return setError("请确认年龄并同意保存资料");
    if (contactShare && !contactValue.trim()) return setError("请先填写要分享的联系方式");
    setBusy(true); setError("");
    try {
      const next = await apiJson<ConversationView>("/api/conversation", jsonBody({ adultConfirmed, poolConsent, visible, contactKind, contactValue: contactValue.trim(), contactShare, turn: conversation.turn, revision: conversation.revision }, "PATCH"));
      setConversation(next);
      await loadReport();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
    finally { setBusy(false); }
  }
  async function generateAiReport() {
    if (!report || aiBusy || busy || reportLoading) return;
    setConsentOpen(false); setAiConsent(true); setAiBusy(true); setAiError(""); setAiMessage("正在解读相符点、差异和下一步可以聊的问题…");
    try {
      const result = await apiJson<ReportResponse>("/api/report", jsonBody({ consent: true, refresh: report.mode === "ai", revision: report.profileUpdatedAt }));
      if (result.aiStatus === "generated" || result.aiStatus === "cached") setReport(result.report);
      const messages: Record<ReportResponse["aiStatus"], string> = { generated: "AI 解读已完成，候选卡片也补充了相处建议。", cached: "已显示当前资料的 AI 解读。", fallback: "这次 AI 解读未完成，匹配结果已保留。可以点击重试。", unavailable: "AI 服务暂时无法连接，可以稍后重试。", limit_reached: "今天的 AI 使用额度已用完，匹配结果仍可查看。", not_requested: "可以再次点击生成解读。" };
      setAiMessage(messages[result.aiStatus]);
    } catch (e) { setAiMessage(""); setAiError(e instanceof Error ? e.message : "AI 解读失败，请重试"); }
    finally { setAiBusy(false); }
  }
  async function deepen() {
    if (!conversation || busy || aiBusy || reportLoading) return;
    setBusy(true); setError("");
    try {
      const next = await apiJson<ConversationView>("/api/conversation", jsonBody({ turn: conversation.turn, revision: conversation.revision }, "PUT"));
      setConversation(next); setReport(null); setScreen("chat"); setAnswer(""); setAdultConfirmed(false); setPoolConsent(false);
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法继续"); }
    finally { setBusy(false); }
  }
  async function restart() {
    if (!conversation || busy || aiBusy || reportLoading || !window.confirm("从第一题开始新的 10 题场景访谈？当前聊天记录会清空；已经保存的档案与正式报告会保留，新的核对保存后才替换。")) return;
    setBusy(true); setError("");
    try {
      const next = await apiJson<ConversationView>("/api/conversation", jsonBody({ turn: conversation.turn, revision: conversation.revision }, "DELETE"));
      setConversation(next); setReport(null); setScreen("chat"); setAnswer(""); setAdultConfirmed(false); setPoolConsent(false); setVisible(false); setContactValue(""); setContactShare(false);
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法重新开始"); }
    finally { setBusy(false); }
  }
  const d = conversation?.draft;
  const blocked = busy || aiBusy || reportLoading;
  const showingAnalysis = screen === "report" && (aiBusy || report?.mode === "ai");
  return <MotionScope><div className="studio-shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">d.</span>妲灵<span className="brand-en">DALING</span></Link><span className="topbar-note">A LITTLE DEEPER, A LITTLE CLOSER.</span><nav className="chat-nav"><a href="/profile">我的资料</a><a href="/account">{username}</a></nav></header>
    <main className="studio-main">
      <div className="studio-heading"><p className="section-kicker">SLOW CONVERSATIONS · MEANINGFUL CONNECTIONS</p><h1>{screen === "report" ? "相遇，从相符的细节开始。" : screen === "review" ? "看看我们聊到的你。" : screen === "searching" ? "正在寻找相符的细节。" : "慢慢聊，遇见懂你的人。"}</h1><p>{screen === "report" ? "先看匹配结果，再了解相符点和还值得聊的问题。" : "像朋友一样聊聊。累了随时先看匹配，回来还能接着聊。"}</p></div>
      <ol className="studio-journey" aria-label="匹配进度"><li className="done"><span>01</span>账号</li><li className={screen === "chat" || screen === "review" ? "active" : "done"} aria-current={screen === "chat" || screen === "review" ? "step" : undefined}><span>02</span>聊聊你</li><li className={showingAnalysis ? "done" : screen === "report" || screen === "searching" ? "active" : ""} aria-current={!showingAnalysis && (screen === "report" || screen === "searching") ? "step" : undefined}><span>03</span>匹配结果</li><li className={showingAnalysis ? "active" : ""} aria-current={showingAnalysis ? "step" : undefined}><span>04</span>相处分析</li></ol>
      {conversation && <div className="interview-version-note"><span>{conversation.protocolVersion < 3 ? "新版：10 个具体场景，轻松重新认识你。" : "10 个问题 · 每题都有具体场景和回答例子"}</span><button className="secondary-btn" disabled={blocked} onClick={() => void restart()}>从头开始 · 10 个问题</button></div>}{error && <p className="error studio-error" role="alert">{error}</p>}
      {loading ? <div className="studio-loading"><LoaderCircle className="spin"/>正在找回你的对话…</div> : <AnimatePresence mode="wait">
        <motion.div key={screen} initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }} transition={{ duration: .3 }}>
          {screen === "chat" && conversation && <section className="conversation-canvas" aria-label="匹配对话">
            <div className="canvas-head"><div className="assistant-identity"><span className="assistant-avatar">d.</span><div><strong>妲灵</strong><span>陪你聊聊，认真了解</span></div></div><span className="topic-progress">第 {Math.min(conversation.step + 1, conversation.totalSteps)} / {conversation.totalSteps} 题</span></div>
            <div className="studio-thread" aria-live="polite">{conversation.messages.map((message, index) => <motion.div className={`chat-line ${message.role}`} key={`${index}-${message.role}`} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div className="chat-bubble"><div>{message.content}</div>{message.role === "assistant" && message.ai?.source === "ai" && <details className="chat-ai-receipt"><summary>AI 回复详情</summary><span>{message.ai.model} · {(message.ai.elapsedMs / 1000).toFixed(1)} 秒</span><code>{message.ai.providerResponseId}</code></details>}</div></motion.div>)}{pendingAnswer && <><div className="chat-line user"><div className="chat-bubble">{pendingAnswer}</div></div><div className="chat-line assistant"><div className="chat-bubble chat-thinking"><span className="thinking-dot"/><span className="thinking-dot"/><span className="thinking-dot"/><span>妲灵正在回应</span></div></div></>}<div ref={bottomRef}/></div>
            {conversation.example && <details className="answer-example" key={conversation.topic}><summary>想不到怎么说？看一个例子</summary><p>{conversation.example}</p><span>只是回答方式的例子，请说自己的真实偏好。</span></details>}<form className="studio-composer" onSubmit={sendAnswer}><label className="sr-only" htmlFor="chat-answer">给妲灵的消息</label><textarea id="chat-answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="说说你的想法，也可以直接问妲灵…" maxLength={conversation.inputLimit} rows={2} disabled={busy} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/><div className="composer-actions"><button className="preview-button" type="button" disabled={blocked} onClick={() => void transition("pause")}><Search size={16}/>聊累了，先看匹配</button><button className="primary-btn send-button" type="submit" disabled={busy || !answer.trim()}><Send size={16}/>{busy ? "回应中" : "发送"}</button></div></form>
            <p className="canvas-footnote">Enter 发送 · Shift + Enter 换行 · 暂停后进度会保留</p>
          </section>}
          {screen === "review" && conversation && d && <section className="review-canvas"><div className="review-heading"><span className="status">保存前核对</span><h2>{d.name}，这是你聊到的自己。</h2><p>深度问题可以以后再聊，现在也能开始匹配。</p></div><div className="review-basics"><p><span>基本资料</span><strong>{genderText[d.gender]} · {d.age} 岁 · {d.city}</strong></p><p><span>想认识</span><strong>{genderText[d.seeking]} · {d.minAge}–{d.maxAge} 岁{d.preferredCity ? ` · ${d.preferredCity}` : ""}</strong></p>{d.interests.length > 0 && <p><span>兴趣</span><strong>{d.interests.join("、")}</strong></p>}</div><div className="depth-summary-grid">{depthKeys.map(key => <div className="depth-summary" key={key}><span>{depthLabels[key]}</span><p>{d.depth.topics[key]?.status === "answered" ? d.depth.topics[key]?.summary : "待了解，可以以后再聊"}</p></div>)}</div>
            <form className="review-form" onSubmit={saveProfile}><label className="checkline"><input type="checkbox" checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)}/><span>我确认已满 18 岁。</span></label><label className="checkline"><input type="checkbox" checked={poolConsent} onChange={e => setPoolConsent(e.target.checked)}/><span>我已核对资料并阅读<a href="/privacy" target="_blank" rel="noreferrer">隐私说明</a>，同意保存并用于匹配。</span></label><label className="checkline"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)}/><span>加入真实匹配池，公开基础资料并比较深度档案。原始对话不向其他用户展示。</span></label><details className="contact-settings"><summary>联系方式与分享授权（可选）</summary><div className="field"><label htmlFor="contact-kind">联系方式 · 不发送给 AI</label><select id="contact-kind" value={contactKind} onChange={e => setContactKind(e.target.value as typeof contactKind)}><option value="wechat">微信</option><option value="telegram">Telegram</option><option value="email">邮箱</option><option value="other">其他</option></select><input aria-label="联系方式" value={contactValue} onChange={e => setContactValue(e.target.value)} maxLength={100} placeholder="仅双向心动并共同授权后可见"/></div><label className="checkline"><input type="checkbox" checked={contactShare} onChange={e => setContactShare(e.target.checked)}/><span>双方心动并同意分享后，显示此联系方式。</span></label></details><div className="review-actions"><button className="primary-btn" disabled={busy || !adultConfirmed || !poolConsent} type="submit">{busy ? "正在保存" : "保存并开始匹配"}</button><button className="secondary-btn" disabled={blocked} type="button" onClick={() => void transition("pause")}>先预览匹配</button></div></form><button className="chat-text-button" type="button" disabled={blocked} onClick={() => void restart()}>需要更正基本资料？开启新对话</button>
          </section>}
          {screen === "searching" && <MatchSearchTransition/>}
          {screen === "report" && <section className="studio-report" aria-label="匹配报告">{report ? <>
            <div className="report-cover"><div><p className="section-kicker">YOUR MATCHING REPORT</p><h2>{report.scope === "preview" ? "先看看，谁和你相符。" : "你的匹配报告，准备好了。"}</h2><p>{report.summary}</p><div className="report-metrics"><div><strong>{report.demoPoolSize}</strong><span>实验档案</span></div><div><strong>{report.demoEligibleCount}</strong><span>{report.missingBasics.length ? "待进一步确认" : "符合双向条件"}</span></div><div><strong>{report.myDepth.answered} / 6</strong><span>已聊的深度主题</span></div></div></div><img src="/illustrations/korean-connection-editorial.png" alt="两条路径在抽象庭院中相遇的艺术插画" loading="lazy"/></div>
            <nav className="report-reading-nav" aria-label="报告阅读顺序"><a href="#matching-results">01 · 匹配结果</a><a href="#matching-analysis">02 · 相处分析</a></nav><div className="report-toolbar"><button className="secondary-btn" disabled={blocked} onClick={() => void (conversation?.status === "paused" ? transition("resume") : deepen())}><MessageCircle size={15}/>继续聊聊</button>{report.scope === "preview" && conversation && conversation.canSave && <button className="primary-btn" disabled={blocked} onClick={() => void transition("review")}>保存当前档案</button>}<a className="secondary-btn" href={report.scope === "preview" ? "/api/conversation/export" : "/api/profile/export"}><Download size={15}/>下载 JSON</a></div>
            {report.missingBasics.length > 0 && <div className="preview-note"><strong>先探索，再慢慢完善。</strong><p>待了解：{report.missingBasics.join("、")}。当前只比较已回答的信息，补充后再确认双方条件。</p></div>}
            {report.myDepth.summaries.length > 0 && <section className="report-depth"><div className="report-section-title"><h2>对你的理解</h2><span>{report.answeredTopics} 个话题已聊</span></div><div className="depth-summary-grid">{report.myDepth.summaries.map(item => <div className="depth-summary" key={item.label}><span>{item.label}</span><p>{item.summary}</p></div>)}</div></section>}
            <div id="matching-results" className="report-section-title"><div><p className="section-kicker">CONNECTIONS TO EXPLORE</p><h2>匹配结果 · 值得了解的人</h2></div><span>12 座城市 · 96 份实验档案</span></div><p className="experiment-note">体验候选来自实验数据集，用于展示匹配方法；并非真实报名者，不提供联系方式。</p>{report.demoCandidates.length ? <><div className="best-match-heading"><p className="section-kicker">YOUR CLOSEST CONNECTION</p><h3>{report.demoCandidates[0].eligibility === "approximate" ? "当前候选中，相对最接近的一位" : report.missingBasics.length ? "先了解一位体验候选" : "当前优先了解的一位"}</h3><p>{report.demoCandidates[0].eligibility === "approximate" ? "先比较尚未满足的条件，再看已知相处共同点。" : report.missingBasics.length ? "补充基本偏好后，再确定是否相符。" : "先看推荐理由，再了解差异和沟通建议。"}</p></div><div className="best-match-card"><CandidateCard candidate={report.demoCandidates[0]}/></div>{report.demoCandidates.length > 1 && <details className="other-matches"><summary>再看其他 {report.demoCandidates.length - 1} 位候选</summary><div className="match-grid">{report.demoCandidates.slice(1).map(candidate => <CandidateCard key={candidate.id} candidate={candidate}/>)}</div></details>}</> : <div className="report-empty"><h3>这次没有符合双方条件的体验候选</h3><p>实验数据的覆盖范围有限，可以继续完善资料，或查看真实匹配池。</p></div>}
            {report.scope === "saved" && <section className="real-connections"><div className="report-section-title"><div><p className="section-kicker">REAL CONNECTIONS</p><h2>真实报名者</h2></div><a className="secondary-btn" href="/profile">管理真实匹配</a></div><p className="muted small">{report.realStatus === "private" ? "在我的资料中选择加入匹配池后，可以查看双方条件相符的报名者。" : `当前有 ${report.realEligibleCount} 位符合双方条件的报名者。`}</p>{report.realCandidates.length > 0 && <div className="match-grid">{report.realCandidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate}/>)}</div>}</section>}
            <section id="matching-analysis" className="ai-analysis-panel" aria-label="匹配分析"><div className="ai-panel-heading"><div><p className="section-kicker">MATCHING ANALYSIS</p><h2><Sparkles size={20}/>匹配分析</h2></div><button className="primary-btn" type="button" disabled={blocked} onClick={() => aiConsent ? void generateAiReport() : setConsentOpen(true)}>{aiBusy ? <><LoaderCircle className="spin" size={16}/>正在分析</> : report.mode === "ai" ? "重新分析" : "开始 AI 分析"}</button></div><p className="ai-panel-intro">先了解当前资料的匹配依据，再看相处建议。</p><MatchingAnalysis report={report}/>{aiMessage && <p className="ai-status" role="status">{aiMessage}</p>}{aiError && <p className="error" role="alert">{aiError}</p>}{report.analysis && <div className="ai-analysis-text"><h3>AI 相处建议</h3>{report.analysis}</div>}</section>
          </> : <div className="report-empty"><h2>再试一次，让报告回来。</h2><p>你的对话进度已经保存。</p><div className="report-toolbar"><button className="primary-btn" disabled={blocked} onClick={() => void loadReport()}>重新加载报告</button><button className="secondary-btn" disabled={blocked} onClick={() => void (conversation?.status === "paused" ? transition("resume") : deepen())}>继续聊聊</button></div></div>}</section>}
        </motion.div>
      </AnimatePresence>}
      <footer className="studio-footer"><button className="chat-text-button" disabled={blocked} onClick={() => void restart()}>开启新对话</button><a href="/privacy">隐私说明</a><a href="/terms">使用规则</a><span>DALING · TAKE YOUR TIME</span></footer>
    </main>
    <Dialog open={consentOpen} onOpenChange={setConsentOpen}><DialogContent className="studio-dialog" showCloseButton={false}><DialogTitle>让 AI 再多理解一点</DialogTitle><DialogDescription>本次会将你的兴趣、相处期待、深度摘要与候选比较结果发送给 DeepSeek。不会发送联系方式或完整聊天记录。</DialogDescription><DialogFooter><button className="secondary-btn" onClick={() => setConsentOpen(false)}>稍后再说</button><button className="primary-btn" onClick={() => void generateAiReport()}>同意并分析</button></DialogFooter></DialogContent></Dialog>
  </div></MotionScope>;
}
