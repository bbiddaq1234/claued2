// GET/POST /api/settings — 설정 조회/변경(+reset). 알 수 없는 키는 400 (6-12).
import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings, resetSettings, isKnownKey, LIMITS } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), limits: LIMITS });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 JSON이 아닙니다." }, { status: 400 });
  }

  if (body && typeof body === "object" && (body as any).reset === true) {
    return NextResponse.json({ settings: resetSettings(), limits: LIMITS });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "요청 본문은 객체여야 합니다." }, { status: 400 });
  }

  const unknownKeys = Object.keys(body).filter((k) => !isKnownKey(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json({ error: `알 수 없는 설정 키: ${unknownKeys.join(", ")}` }, { status: 400 });
  }

  const settings = setSettings(body as Record<string, unknown>);
  return NextResponse.json({ settings, limits: LIMITS });
}
