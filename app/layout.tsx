import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "妲灵 | 双向交友匹配",
  description: "填写你的期待，发现双方条件都合适的人。资料由你决定是否加入匹配池。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
