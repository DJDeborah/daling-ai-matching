export const metadata = { title: "使用规则 | 妲灵" };

export default function TermsPage() {
  return <main style={{ maxWidth: 760, padding: "42px 22px 70px", margin: "auto", lineHeight: 1.8 }}>
    <a href="/">← 返回妲灵</a>
    <h1 style={{ marginTop: 28, fontSize: "2rem" }}>使用规则</h1>
    <p>本网站仅供年满 18 岁的用户自愿交友使用。请如实填写资料，并尊重其他用户的边界与拒绝。</p>
    <ul>
      <li>不要冒用他人身份，也不要发布违法、骚扰、歧视或露骨内容。</li>
      <li>不要在公开介绍中放联系方式；仅在双方自愿时分享联系方式。</li>
      <li>线下见面前请自行核实对方身份，选择安全场所，避免转账或共享证件信息。</li>
      <li>你可以随时关闭资料可见性或删除资料。屏蔽会终止与该用户的站内匹配。</li>
    </ul>
    <p>这是功能测试版，尚无身份核验或人工内容审核。我们会继续完善举报与安全功能。</p>
  </main>;
}
