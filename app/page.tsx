import { getCurrentUser } from "@/lib/auth";
import MatchingApp from "./matching-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  return (
    <MatchingApp
      signedIn={Boolean(user)}
      displayName={user?.username ?? null}
    />
  );
}
