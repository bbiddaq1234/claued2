// GET /api/file?path= — ./data 내부 파일만 서빙(스크린샷·이미지 미리보기용).
// 경로 탈출 방지 필수 + NFC 정규화(6-12).
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { dataRoot, isInsideDataRoot } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
};

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path");
  if (!raw) {
    return NextResponse.json({ error: "path 파라미터가 필요합니다." }, { status: 400 });
  }

  const candidate = path.isAbsolute(raw) ? raw : path.join(dataRoot(), raw);

  // ⚠️ 7-23: 경로 비교 "전에" 양쪽 모두 NFC로 정규화한다(isInsideDataRoot 내부에서
  // 처리). macOS는 한글 경로를 NFD로 주고 브라우저의 URL 파라미터는 NFC라서,
  // 정규화 없이 startsWith로 비교하면 한글 경로의 이미지 미리보기가 전부 403이 된다.
  if (!isInsideDataRoot(candidate)) {
    return NextResponse.json({ error: "허용되지 않은 경로입니다." }, { status: 403 });
  }

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  const buf = fs.readFileSync(candidate);
  const ext = path.extname(candidate).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=60",
    },
  });
}
