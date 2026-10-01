import { getCurrentUser } from "@/lib/auth";
import AccountApp from "./account-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "账号 | 妲灵" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  return <AccountApp username={user?.username ?? null} />;
}
