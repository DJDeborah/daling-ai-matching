import { clearSessionCookie, revokeSession } from "@/lib/auth";
import { database, jsonError, sameOrigin } from "@/lib/database";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("请求来源不正确", 403);
  try {
    await revokeSession(database(), request);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request), "Cache-Control": "no-store" } });
  } catch {
    console.error("logout failed");
    return jsonError("退出失败，请稍后重试", 503);
  }
}
