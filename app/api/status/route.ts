// GET /api/status — claude 설치·네이버 세션 유효성·Cloudflare 키 설정 여부·현재 설정 (6-12).
// ?refresh=1 로 세션 캐시 무효화.
import { NextRequest, NextResponse } from "next/server";
import { checkClaude } from "@/lib/claude";
import { verifySession } from "@/lib/naver/session";
import { getSettings, LIMITS } from "@/lib/settings";
import { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } from "@/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  const [claude, naver] = await Promise.all([checkClaude(), verifySession({ refresh })]);

  return NextResponse.json({
    claude,
    naver,
    cloudflareConfigured: Boolean(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN),
    settings: getSettings(),
    limits: LIMITS,
  });
}
