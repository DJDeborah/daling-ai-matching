import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import MatchingApp from "../matching-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "资料与真实匹配 | 妲灵" };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/account");
  return <MatchingApp signedIn displayName={user.username} />;
}
