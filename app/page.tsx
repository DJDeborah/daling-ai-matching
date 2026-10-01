import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import ChatApp from "./chat-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/account");
  return <ChatApp username={user.username} />;
}
