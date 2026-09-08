// POST /api/naver/login — 로그인 창을 띄운다. 사용자가 직접 로그인할 때까지
// 최대 5분 대기하므로 maxDuration을 길게 잡는다(6-12).
import { NextResponse } from "next/server";
import { loginInteractive } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST() {
  const result = await loginInteractive();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
