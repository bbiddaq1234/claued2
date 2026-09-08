// GET /api/jobs — 최근 잡 목록. POST /api/jobs — 잡 생성+즉시 실행(6-12).
import { NextRequest, NextResponse } from "next/server";
import { listRecentJobs, hasActiveJob } from "@/lib/jobs";
import { startJob } from "@/lib/pipeline";
import { JobInputsSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = listRecentJobs(30).map((j) => ({
    ...j,
    inputs: safeParseJson(j.inputs),
  }));
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 JSON이 아닙니다." }, { status: 400 });
  }

  const parsed = JobInputsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "입력값이 올바르지 않습니다.", issues: parsed.error.issues }, { status: 400 });
  }

  // ⚠️ 진행 중 잡이 있으면 409로 막는다 — 버튼 연타·SSE 재연결로 잡이
  // 두 번 만들어지는 것을 방지한다(7-16).
  if (hasActiveJob()) {
    return NextResponse.json({ error: "이미 진행 중인 작업이 있습니다." }, { status: 409 });
  }

  const inputs = parsed.data;
  const keyword = inputs.mode === "auto" ? inputs.keyword ?? "" : inputs.topic ?? "";
  const jobId = startJob(keyword, inputs);

  return NextResponse.json({ id: jobId }, { status: 201 });
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
