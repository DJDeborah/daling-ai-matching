"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { blankProfile, genderLabels, profileSchema, type DraftProfile, type Gender, type ProfileInput } from "@/lib/profile";

type Candidate = {
  id: string; name: string; age: number; city: string; heightCm: number | null;
  bodyType: string; school: string; mbti: string; zodiac: string;
  interests: string[]; about: string; partnerNote: string; reasons: string[];
  liked: boolean; mutual: boolean; contactKind?: string | null; contactValue?: string | null;
};
type State = { profile: ProfileInput | null; candidates: Candidate[]; matches: Candidate[] };
type Props = { signedIn: boolean; displayName: string | null };
type AiSuggestion = { intro: string; interests: string[] };
type View = "wizard" | "discover" | "matches" | "profile";

const steps = [
  { title: "先认识你", desc: "用一个称呼开始，不需要填写真实姓名。" },
  { title: "年龄与期待", desc: "只记录年龄，不收集完整生日。" },
  { title: "你想认识谁", desc: "这些条件会双向检查，双方都符合才会出现。" },
  { title: "身高与体型", desc: "这一页全部可以跳过；身高区间会作为硬条件。" },
  { title: "更多关于你", desc: "学校、MBTI 和星座是可选展示信息，不决定你是否有资格被推荐。" },
  { title: "聊聊你的兴趣", desc: "共同兴趣会影响排序；你写的介绍会展示在候选卡上。" },
  { title: "发布前确认", desc: "资料由你决定是否进入匹配池；联系方式仅在双方心动且双方都同意分享后显示。" },
];
const bodyTypes = ["", "清瘦", "匀称", "运动型", "微胖", "其他"];
const zodiac = ["", "白羊", "金牛", "双子", "巨蟹", "狮子", "处女", "天秤", "天蝎", "射手", "摩羯", "水瓶", "双鱼"];
const contactNames: Record<string, string> = { wechat: "微信", telegram: "Telegram", email: "邮箱", other: "其他" };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

function Choices({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <RadioGroup value={value} onValueChange={onChange} className="choices">
    {options.map(([id, label]) => <label className="choice" key={id}><RadioGroupItem value={id} aria-label={label} />{label}</label>)}
  </RadioGroup>;
}

async function requestJson<T = { ok?: boolean; mutual?: boolean }>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "请求失败，请稍后重试");
  return data;
}

export default function MatchingApp({ signedIn, displayName }: Props) {
  const [view, setView] = useState<View>("wizard");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DraftProfile>(blankProfile);
  const [saved, setSaved] = useState<ProfileInput | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matches, setMatches] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [interestText, setInterestText] = useState("");
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem("daling-draft");
      if (draft) setForm({ ...blankProfile, ...JSON.parse(draft) });
      const draftStep = Number(sessionStorage.getItem("daling-step"));
      if (Number.isInteger(draftStep) && draftStep >= 0 && draftStep < steps.length) setStep(draftStep);
    } catch { /* session storage may be unavailable */ }
    if (signedIn) {
      requestJson<State>("/api/state").then((data) => {
        setSaved(data.profile); setCandidates(data.candidates); setMatches(data.matches);
        if (data.profile) { setForm(data.profile); setView("discover"); }
      }).catch(e => setError(e.message)).finally(() => setLoading(false));
    }
  }, [signedIn]);

  useEffect(() => {
    if (view !== "wizard") return;
    try {
      sessionStorage.setItem("daling-draft", JSON.stringify(form));
      sessionStorage.setItem("daling-step", String(step));
    } catch { /* optional device draft */ }
  }, [form, step, view]);

  function update<K extends keyof DraftProfile>(key: K, value: DraftProfile[K]) {
    setForm(old => ({ ...old, [key]: value })); setError("");
  }

  function updateNumber(key: "age" | "minAge" | "maxAge" | "heightCm" | "preferredHeightMin" | "preferredHeightMax", text: string) {
    update(key, (text === "" ? (key.includes("Height") || key === "heightCm" ? null : 0) : Number(text)) as DraftProfile[typeof key]);
  }

  async function refresh() {
    const data = await requestJson<State>("/api/state");
    setSaved(data.profile); setCandidates(data.candidates); setMatches(data.matches);
  }

  function next() {
    if (step === 0 && form.name.trim().length < 2) return setError("请填写至少两个字的称呼");
    if (step === 1 && (form.age < 18 || form.age > 80)) return setError("本站仅供 18 岁及以上用户使用，请检查年龄");
    if (step === 2 && (!form.city.trim() || form.minAge > form.maxAge)) return setError("请填写城市并检查期待的年龄范围");
    setError("");
    if (step < steps.length - 1) setStep(step + 1);
    else void save();
  }

  async function save() {
    if (!signedIn) { setError("保存资料需要先注册或登录站内账号"); return; }
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.code === "custom" ? issue.message : "请检查必填项、数字范围与同意选项");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      await refresh();
      try { sessionStorage.removeItem("daling-draft"); sessionStorage.removeItem("daling-step"); } catch { /* optional device draft */ }
      setView("discover"); setMessage(parsed.data.visible ? "资料已发布，可以开始发现符合双方条件的人。" : "资料已私密保存。发布后才能进入匹配池。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function toggleLike(candidate: Candidate) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestJson("/api/likes", { method: candidate.liked ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: candidate.id }) });
      await refresh();
      setMessage(result.mutual ? "你们已双向心动，可以在「双向心动」查看联系信息。" : candidate.liked ? "已撤回心动。" : "心动已送出，等待对方回应。");
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function block(candidate: Candidate) {
    if (!window.confirm(`屏蔽 ${candidate.name}？你们将不再互相出现，已有心动也会取消。`)) return;
    setBusy(true); setError("");
    try {
      await requestJson("/api/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: candidate.id }) });
      await refresh(); setMessage("已屏蔽该用户。");
    } catch (e) { setError(e instanceof Error ? e.message : "屏蔽失败"); }
    finally { setBusy(false); }
  }

  async function deleteProfile() {
    if (!window.confirm("确定删除资料吗？这会同时删除你的心动和屏蔽记录，无法恢复。")) return;
    setBusy(true); setError("");
    try {
      await requestJson("/api/profile", { method: "DELETE" });
      setSaved(null); setCandidates([]); setMatches([]); setForm(blankProfile); setStep(0); setView("wizard");
      try { sessionStorage.removeItem("daling-draft"); sessionStorage.removeItem("daling-step"); } catch { /* optional device draft */ }
      setMessage("资料已删除。");
    } catch (e) { setError(e instanceof Error ? e.message : "删除失败"); }
    finally { setBusy(false); }
  }

  function addInterest() {
    const text = interestText.trim();
    if (!text) return;
    if (text.length > 20) return setError("兴趣标签最多 20 个字");
    if (form.interests.length >= 8) return setError("最多添加 8 个兴趣标签");
    if (form.interests.some(x => x.toLocaleLowerCase() === text.toLocaleLowerCase())) return setError("这个兴趣已经添加过了");
    update("interests", [...form.interests, text]); setInterestText("");
  }

  async function askAi() {
    setBusy(true); setError(""); setSuggestion(null);
    try {
      const result = await requestJson<{ suggestion: AiSuggestion }>("/api/assist", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ about: form.about }),
      });
      setSuggestion(result.suggestion);
    } catch (e) { setError(e instanceof Error ? e.message : "AI 助手暂时不可用"); }
    finally { setBusy(false); }
  }

  function applySuggestion() {
    if (!suggestion) return;
    const interests = [...form.interests];
    for (const item of suggestion.interests) {
      if (interests.length >= 8) break;
      if (!interests.some(current => current.toLocaleLowerCase() === item.toLocaleLowerCase())) interests.push(item);
    }
    setForm(old => ({ ...old, about: suggestion.intro, interests }));
    setSuggestion(null); setMessage("已采用 AI 建议，你可以继续编辑后再保存。");
  }

  function candidateCard(candidate: Candidate, inMatches = false) {
    return <article className="card candidate" key={candidate.id}>
      <div className="candidate-top"><span className="avatar" aria-hidden="true">{candidate.name.slice(0, 1)}</span><div><h3>{candidate.name} · {candidate.age}</h3><span className="muted small">{candidate.city}{candidate.heightCm ? ` · ${candidate.heightCm} cm` : ""}</span></div></div>
      {candidate.about && <p>{candidate.about}</p>}
      <div className="tags">{candidate.reasons.map(reason => <span className="tag" key={reason}>{reason}</span>)}</div>
      {candidate.interests.length > 0 && <p>兴趣：{candidate.interests.join(" · ")}</p>}
      {candidate.partnerNote && <p>期待：{candidate.partnerNote}</p>}
      {inMatches && <div className="contact-box">{candidate.contactValue ? <><strong>对方同意分享的{contactNames[candidate.contactKind ?? ""] ?? "联系方式"}：</strong> {candidate.contactValue}</> : "目前暂无可显示的联系方式。双方都开启分享后才会显示。"}</div>}
      <div className="candidate-actions">
        <button className={candidate.liked ? "secondary-btn" : "primary-btn"} type="button" disabled={busy} onClick={() => void toggleLike(candidate)}>{candidate.liked ? "撤回心动" : "想认识"}</button>
        <button className="secondary-btn" type="button" disabled={busy} onClick={() => void block(candidate)}>屏蔽</button>
      </div>
    </article>;
  }

  return <div className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">✳</span>妲灵</a><span className="topbar-note">双向选择，认真认识</span><a className="topbar-link" href="/account">{signedIn ? "账号设置" : "注册 / 登录"}</a></header>
    <div className="workspace">
      <aside className="story"><div><span className="eyebrow">Daling / Mutual Matching</span><h1>遇见<br />和你<em>双向</em><br />合拍的人。</h1><p className="story-copy">填写你的基本情况和期待。只有彼此条件符合，你们才会出现在对方的发现页。</p></div><div className="orbit" aria-hidden="true"><span className="orbit-ring"/><span className="orbit-ring"/><span className="orbit-core">✳</span><span className="orbit-dot"/><span className="orbit-dot two"/></div><div className="story-foot"><span>真实报名资料</span><span>双向偏好</span><span>自主删除</span></div></aside>
      <main className="content">
        <div className="content-head"><div><p className="section-kicker">认识从这里开始</p><h2>{view === "wizard" ? "填写你的交友资料" : view === "discover" ? "发现合拍的人" : view === "matches" ? "双向心动" : "我的资料"}</h2></div>{displayName && <span className="muted small">你好，{displayName}</span>}</div>
        {saved && view !== "wizard" && <nav className="tabbar" aria-label="页面导航">{([ ["discover", "发现"], ["matches", `双向心动 ${matches.length ? `· ${matches.length}` : ""}`], ["profile", "我的资料"] ] as [View, string][]).map(([id, label]) => <button key={id} type="button" className={view === id ? "active" : ""} onClick={() => { setView(id); setError(""); setMessage(""); }}>{label}</button>)}</nav>}
        {loading && <div className="card empty"><h3>正在读取你的资料…</h3></div>}
        {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
        {!loading && view === "wizard" && <section className="card form-card" aria-label="资料问卷">
          {!signedIn && <div className="notice">可以先填写草稿。保存和查看候选人需要<a href="/account">注册或登录站内账号</a>；草稿只暂存在本浏览器标签页。</div>}
          <div className="progress-row"><span>步骤 {step + 1} / {steps.length}</span><span>{Math.round(((step + 1) / steps.length) * 100)}%</span></div><Progress value={((step + 1) / steps.length) * 100} aria-label="填写进度" />
          <h3 className="step-title">{steps[step].title}</h3><p className="step-desc">{steps[step].desc}</p>
          {step === 0 && <><Field label="怎么称呼你？"><Input maxLength={24} value={form.name} onChange={e => update("name", e.target.value)} placeholder="例如：小林" /></Field><Field label="你的性别"><Choices value={form.gender} onChange={v => update("gender", v as Gender)} options={Object.entries(genderLabels)} /></Field></>}
          {step === 1 && <><div className="field-pair"><Field label="你的年龄"><Input type="number" min={18} max={80} value={form.age || ""} onChange={e => updateNumber("age", e.target.value)} /></Field><Field label="希望认识的年龄区间"><div className="field-pair"><Input aria-label="最小年龄" type="number" min={18} max={80} value={form.minAge || ""} onChange={e => updateNumber("minAge", e.target.value)} /><Input aria-label="最大年龄" type="number" min={18} max={80} value={form.maxAge || ""} onChange={e => updateNumber("maxAge", e.target.value)} /></div></Field></div><div className="notice">仅供成年人使用。这里没有身份核验，请不要把资料中的年龄当作已验证信息。</div></>}
          {step === 2 && <><Field label="希望认识谁"><Choices value={form.seeking} onChange={v => update("seeking", v as DraftProfile["seeking"])} options={[["man", "男"], ["woman", "女"], ["nonbinary", "非二元"], ["any", "不限"]]} /></Field><Field label="你所在的城市"><Input maxLength={40} value={form.city} onChange={e => update("city", e.target.value)} placeholder="例如：上海" /></Field><Field label="希望对方所在城市" hint="留空代表不限；填写时请使用城市名，如上海。"><Input maxLength={40} value={form.preferredCity} onChange={e => update("preferredCity", e.target.value)} placeholder="不限" /></Field></>}
          {step === 3 && <><Field label="你的身高（厘米，可选）"><Input type="number" min={120} max={230} value={form.heightCm ?? ""} onChange={e => updateNumber("heightCm", e.target.value)} placeholder="可不填" /></Field><div className="field-pair"><Field label="希望对方最低身高"><Input type="number" min={120} max={230} value={form.preferredHeightMin ?? ""} onChange={e => updateNumber("preferredHeightMin", e.target.value)} placeholder="不限" /></Field><Field label="希望对方最高身高"><Input type="number" min={120} max={230} value={form.preferredHeightMax ?? ""} onChange={e => updateNumber("preferredHeightMax", e.target.value)} placeholder="不限" /></Field></div><Field label="你的体型（可选）"><Choices value={form.bodyType} onChange={v => update("bodyType", v)} options={bodyTypes.map(x => [x, x || "不填写"])} /></Field><Field label="喜欢的体型（可选）"><Choices value={form.preferredBodyType} onChange={v => update("preferredBodyType", v)} options={bodyTypes.map(x => [x, x || "不限"])} /></Field></>}
          {step === 4 && <><Field label="学校或专业（可选）"><Input maxLength={80} value={form.school} onChange={e => update("school", e.target.value)} placeholder="例如：建筑设计" /></Field><div className="field-pair"><Field label="MBTI（可选）"><Input maxLength={4} value={form.mbti} onChange={e => update("mbti", e.target.value.toUpperCase())} placeholder="例如 ENFP" /></Field><Field label="你的星座（可选）"><Choices value={form.zodiac} onChange={v => update("zodiac", v)} options={zodiac.map(x => [x, x || "不填"])} /></Field></div><Field label="希望对方的星座（可选）" hint="仅轻微影响推荐排序，不影响候选资格。"><Choices value={form.preferredZodiac} onChange={v => update("preferredZodiac", v)} options={zodiac.map(x => [x, x || "不限"])} /></Field></>}
          {step === 5 && <><Field label="兴趣标签" hint="最多 8 个。输入一个兴趣，点击添加。"><div className="field-pair"><Input maxLength={20} value={interestText} onChange={e => setInterestText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }} placeholder="例如：徒步" /><button className="secondary-btn" type="button" onClick={addInterest}>添加兴趣</button></div><div className="tags">{form.interests.map(tag => <button className="tag" type="button" key={tag} onClick={() => update("interests", form.interests.filter(x => x !== tag))}>{tag} ×</button>)}</div></Field><Field label="介绍一下自己（可选）" hint="请不要在公开介绍中填写电话、住址等私人信息。"><Textarea maxLength={400} value={form.about} onChange={e => { update("about", e.target.value); setSuggestion(null); }} placeholder="例如：喜欢周末逛书店，也爱户外徒步。" /></Field><div className="ai-actions"><button className="secondary-btn" type="button" disabled={busy || !signedIn || form.about.trim().length < 10} onClick={() => void askAi()}>{busy ? "正在整理…" : "AI 帮我整理介绍"}</button><span className="hint">点击后会将这段介绍发送给 DeepSeek；建议仅供参考，采用前请核对。</span></div>{suggestion && <div className="ai-suggestion"><strong>AI 建议预览</strong><p>{suggestion.intro}</p><p className="small muted">兴趣：{suggestion.interests.length ? suggestion.interests.join(" · ") : "未提取到"}</p><div className="candidate-actions"><button className="primary-btn" type="button" onClick={applySuggestion}>采用并继续编辑</button><button className="secondary-btn" type="button" onClick={() => setSuggestion(null)}>忽略</button></div></div>}<Field label="想认识怎样的人（可选）"><Textarea maxLength={240} value={form.partnerNote} onChange={e => update("partnerNote", e.target.value)} placeholder="聊得来的人，愿意一起探索城市。" /></Field></>}
          {step === 6 && <><div className="notice">当前版本不收集照片和体重，也不提供未经验证的“阅后即焚”或身份认证承诺。</div><Field label="联系方式（可选）"><Choices value={form.contactKind} onChange={v => update("contactKind", v as DraftProfile["contactKind"])} options={[["wechat", "微信"], ["telegram", "Telegram"], ["email", "邮箱"], ["other", "其他"]]} /><Input maxLength={100} value={form.contactValue} onChange={e => update("contactValue", e.target.value)} placeholder="仅双方都同意后可见" /></Field><label className="checkline"><Checkbox checked={form.contactShare} onCheckedChange={v => update("contactShare", v === true)} /><span>双方都表达心动后，同意向对方显示我填写的联系方式。</span></label><label className="checkline"><Checkbox checked={form.adultConfirmed} onCheckedChange={v => update("adultConfirmed", v === true)} /><span>我确认自己已满 18 岁。</span></label><label className="checkline"><Checkbox checked={form.poolConsent} onCheckedChange={v => update("poolConsent", v === true)} /><span>我已阅读 <a href="/privacy" target="_blank">资料与隐私说明</a>，同意按上述范围保存和使用资料。</span></label><label className="checkline"><Checkbox checked={form.visible} onCheckedChange={v => update("visible", v === true)} /><span>现在将资料加入匹配池，让符合双方条件的用户看到我的公开资料。</span></label></>}
          <div className="actions">{step > 0 ? <button className="secondary-btn" type="button" onClick={() => { setStep(step - 1); setError(""); }}>上一步</button> : <span className="small muted">预计 3 分钟</span>}{step === steps.length - 1 && !signedIn ? <a className="primary-btn" href="/account">注册或登录后保存</a> : <button className="primary-btn" type="button" onClick={next} disabled={busy}>{step === steps.length - 1 ? busy ? "正在保存…" : "保存资料" : "继续"}</button>}</div>
        </section>}
        {!loading && view === "discover" && <>{!saved?.visible ? <div className="card empty"><h3>资料还未进入匹配池</h3><p>在「我的资料」里编辑并选择公开后，才能发现双方都符合条件的人。</p><button className="primary-btn" type="button" onClick={() => { setStep(6); setView("wizard"); }}>设置资料</button></div> : candidates.length ? <div className="candidate-grid">{candidates.map(x => candidateCard(x))}</div> : <div className="card empty"><h3>暂时没有符合双方条件的人</h3><p>我们只显示已报名并同意公开的资料。可以稍后再来，或在资料里放宽城市、年龄与身高条件。</p><button className="secondary-btn" type="button" onClick={() => { setStep(1); setView("wizard"); }}>调整条件</button></div>}</>}
        {!loading && view === "matches" && (matches.length ? <div className="candidate-grid">{matches.map(x => candidateCard(x, true))}</div> : <div className="card empty"><h3>还没有双向心动</h3><p>当你和对方都选择「想认识」后，才会出现在这里。</p><button className="primary-btn" type="button" onClick={() => setView("discover")}>去发现</button></div>)}
        {!loading && view === "profile" && saved && <div className="card profile-summary"><span className={saved.visible ? "status" : "status off"}>{saved.visible ? "已加入匹配池" : "私密资料"}</span><h3>{saved.name} · {saved.age} 岁</h3><p>{saved.city} · 希望认识 {saved.seeking === "any" ? "不限性别" : genderLabels[saved.seeking]}</p><p>期待年龄：{saved.minAge}–{saved.maxAge} 岁{saved.preferredCity ? ` · ${saved.preferredCity}` : ""}</p><p>兴趣：{saved.interests.length ? saved.interests.join(" · ") : "未填写"}</p><div className="candidate-actions"><button className="primary-btn" type="button" onClick={() => { setForm(saved); setStep(0); setView("wizard"); }}>编辑资料</button><button className="secondary-btn danger-btn" type="button" disabled={busy} onClick={() => void deleteProfile()}>删除全部资料</button></div></div>}
        <p className="footer-note">妲灵测试版 · 仅供成年人使用 · 无身份认证或人工审核 · <a href="/privacy">资料与隐私说明</a> · <a href="/terms">使用规则</a></p>
      </main>
    </div>
  </div>;
}
