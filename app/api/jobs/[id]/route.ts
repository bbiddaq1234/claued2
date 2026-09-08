// GET /api/jobs/[id] — 잡 + 글감 + 초안 + 이미지 + 결과를 한 번에 (6-12).
import { NextResponse } from "next/server";
import { getJobDetail } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) {
    return NextResponse.json({ error: "잡 id가 올바르지 않습니다." }, { status: 400 });
  }

  const detail = getJobDetail(jobId);
  if (!detail.job) {
    return NextResponse.json({ error: "잡을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    job: { ...detail.job, inputs: safeParseJson(detail.job.inputs) },
    sources: detail.sources,
    ideas: detail.ideas,
    drafts: detail.drafts.map((d: any) => ({ ...d, body_json: safeParseJson(d.body_json) })),
    images: detail.images,
    posts: detail.posts,
  });
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
