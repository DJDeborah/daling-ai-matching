import type { Metadata } from "next";
import "./globals.css";
import "./daling-design.css";

export const metadata: Metadata = {
  title: "妲灵 Daling | 深度对话与双向匹配",
  description: "通过有结构的自然对话，了解生活、价值观、支持方式与关系边界，核对深度档案并阅读双向匹配报告。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
