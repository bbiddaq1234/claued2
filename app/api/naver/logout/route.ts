// POST /api/naver/logout — 저장된 로그인 정보를 지운다.
import { NextResponse } from "next/server";
import { logout } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  logout();
  return NextResponse.json({ ok: true });
}
