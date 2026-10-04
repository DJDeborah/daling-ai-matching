import { answerConversation, loadConversation, resetConversation, transitionConversation, deepenConversation, ConversationAiUnavailable, ConversationConflict, ConversationLimit, ConversationValidation } from "./conversation";
import { containsContact } from "./profile";
import { analyzeMatchingReport, getMatchingReport } from "./report-service";
import { compactText, currentQuestion, formatMatchingReport } from "./wechat-format";

export function botHelp(site: string) {
  return `我是妲灵，按大约 10 个话题慢慢了解你，每次回答都会交给 AI 结合上下文回应。\n「开始」「进度」查看当前问题\n「暂停」「匹配」先看匹配预览\n「继续」接着聊\n「分析」了解 AI 分析授权\n「重新开始」重置本轮对话\n保存档案、加入真实匹配池和管理绑定：${site}/account`;
}
export async function wechatBotReply(db: D1Database, userId: string, text: string, site: string): Promise<string> {
  const view = await loadConversation(db, userId);
  if (/^(帮助|help)$/i.test(text)) return botHelp(site);
  if (/^(开始|进度)$/.test(text)) return currentQuestion(view, site);
  if (/^绑定(?:\s|$)/.test(text)) return `这个微信已绑定账号。换绑前请在网站解除绑定：${site}/account`;
  if (/^(重来|重新开始|重置)$/.test(text)) return `重新开始会删除这轮旧对话，保留已保存的交友档案。确定的话发送「确认重新开始」。`;
  if (text === "确认重新开始") {
    const next = await resetConversation(db, userId, view.turn, view.revision);
    return `已经重新开始。\n${currentQuestion(next, site)}`;
  }
  if (/^(保存|加入匹配池|真实匹配|删除账号|解绑)$/.test(text)) return `请在网站核对资料并选择保存、成年确认、真实匹配和分享授权，或管理账号与绑定：${site}/account`;
  if (/^(继续|补充资料)$/.test(text)) {
    const next = view.status === "paused" ? await transitionConversation(db, userId, view.turn, view.revision, "resume")
      : view.status === "complete" ? await deepenConversation(db, userId, view.turn, view.revision) : view;
    return currentQuestion(next, site);
  }
  if (/^(暂停|停止|匹配)$/.test(text)) {
    if (view.status === "collecting" || view.status === "review") await transitionConversation(db, userId, view.turn, view.revision, "pause");
    return formatMatchingReport((await getMatchingReport(db, userId)).report, site);
  }
  if (/^(分析|AI分析|AI 分析)$/i.test(text)) return `AI 分析会将你已提供的兴趣、期待、深度摘要，以及实验候选资料发送给 DeepSeek，生成匹配解读。不发送真实候选资料或微信身份。\n同意的话发送「确认分析」；也可以发送「匹配」查看规则报告。`;
  if (text === "确认分析") {
    if (view.status === "collecting" || view.status === "review") await transitionConversation(db, userId, view.turn, view.revision, "pause");
    const result = await analyzeMatchingReport(db, userId);
    const hint = result.aiStatus === "limit_reached" ? "今天的 AI 次数已用完，先给你规则报告。\n" : result.aiStatus === "fallback" || result.aiStatus === "unavailable" ? "AI 分析暂时不可用，先给你规则报告。\n" : "";
    return compactText(hint + formatMatchingReport(result.report, site));
  }
  if (view.status !== "collecting") return `对话当前${view.status === "paused" ? "已暂停" : "等待网页核对或已经保存"}。发送「继续」续聊，或「匹配」查看报告。${view.status === "review" ? `\n核对并保存：${site}/` : ""}`;
  if (containsContact(text)) return "对话中不要填写联系方式。完成资料后可在网站单独设置分享授权。";
  if (text.length > view.inputLimit) return `这一项最多 ${view.inputLimit} 字，可以保留最重要的部分；也可以发送「暂停」。`;
  try {
    const next = await answerConversation(db, userId, view.turn, view.revision, text);
    const reply = next.messages.at(-1)?.content || next.question;
    return compactText(`${reply}${next.status === "review" ? `\n发送「匹配」查看预览；保存和授权请在 ${site}/ 完成。` : ""}`);
  } catch (error) {
    if (error instanceof ConversationConflict) return `对话刚刚在另一处更新了。\n${currentQuestion(await loadConversation(db, userId), site)}`;
    if (error instanceof ConversationAiUnavailable || error instanceof ConversationLimit || error instanceof ConversationValidation) return `${error.message}\n进度已保存，请稍后重新发送回答，或发送「匹配」。`;
    throw error;
  }
}
