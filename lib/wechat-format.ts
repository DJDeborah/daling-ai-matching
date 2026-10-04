import type { ConversationView } from "./conversation";
import type { MatchReport } from "./report";

export const WECHAT_TEXT_BYTES = 2048;
export function compactText(value: string, limit = WECHAT_TEXT_BYTES): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= limit) return value;
  let out = "";
  let used = 0;
  for (const char of value) {
    const bytes = encoder.encode(char).length;
    if (used + bytes > limit - 3) break;
    out += char; used += bytes;
  }
  return out.trimEnd() + "…";
}

export function currentQuestion(view: ConversationView, site: string): string {
  if (view.status === "complete") return `资料已保存，可以发送「匹配」看报告，或打开网站管理资料：${site}/profile`;
  if (view.status === "review") return `这轮已经聊完 ${view.step}/${view.totalSteps} 个话题。发送「匹配」先看预览；保存档案和进入真实匹配池，需要在网站核对并授权：${site}/`;
  return compactText(`已聊 ${view.step}/${view.totalSteps} 个话题。${view.status === "paused" ? "对话已暂停，发送「继续」可接着聊。\n" : ""}${view.question}${view.example ? `\n例如：${view.example}` : ""}\n随时发送「暂停」或「匹配」，不用答完。`);
}

export function formatMatchingReport(report: MatchReport, site: string): string {
  const candidate = report.demoCandidates[0];
  const lines = [`匹配${report.scope === "preview" ? "预览" : "报告"} · 已聊 ${report.answeredTopics}/${report.totalTopics} 个话题`, compactText(report.analysis || report.summary, 600)];
  if (candidate) {
    lines.push(`\n体验候选：${candidate.name} · ${candidate.age} 岁 · ${candidate.city}（实验档案）`);
    lines.push(...candidate.reasons.slice(0, 2).map(reason => `• ${compactText(reason, 140)}`));
    if (candidate.narrative) lines.push(compactText(candidate.narrative, 300));
    if (candidate.eligibility === "approximate") lines.push("这是相对最接近的参考对象，还未完全符合双方条件。");
    if (candidate.unmetConditions.length) lines.push(`实际差距：${compactText(candidate.unmetConditions.join("；"), 180)}`);
    if (candidate.unknownConditions.length) lines.push(`待确认：${compactText(candidate.unknownConditions.slice(0, 3).join("；"), 180)}`);
    const discussion = candidate.compatibility.dimensions.find(item => item.discussion)?.discussion;
    if (discussion) lines.push(`值得聊聊：${compactText(discussion, 160)}`);
  }
  if (report.missingBasics.length) lines.push(`还没了解：${compactText(report.missingBasics.join("、"), 120)}`);
  if (report.realCandidates.length) lines.push(`另有 ${report.realEligibleCount} 位符合双向条件的真实池候选，请登录网站查看。`);
  // Reserve room for the authenticated website link and source disclosure.
  const footer = `\n实验档案用于体验，不对应真实报名者、不提供联系。\n完整报告：${site}/\n发送「继续」续聊，「分析」查看 AI 分析授权。`;
  return compactText(lines.join("\n"), WECHAT_TEXT_BYTES - new TextEncoder().encode(footer).length) + footer;
}
