import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "妲灵 | 双向交友匹配",
  description: "先注册站内账号，再通过逐题 AI 对话认识彼此，核对资料并获取双向匹配报告。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
