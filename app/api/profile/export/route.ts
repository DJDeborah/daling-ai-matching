import { getCurrentUser } from "@/lib/auth";
import { database, jsonError, ownProfile } from "@/lib/database";
import { matchingDocument, rowToInput } from "@/lib/profile";

export const runtime = "edge";
export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return jsonError("请先登录", 401);
  try {
    const row = await ownProfile(database(), user.userId);
    if (!row) return jsonError("请先完成并保存档案", 409);
    return new Response(JSON.stringify(matchingDocument(rowToInput(row)), null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="daling-matching-profile.json"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch { return jsonError("暂时无法导出档案，请稍后重试", 503); }
}
