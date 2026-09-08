// GET /api/jobs/[id]/stream — SSE. job_logs를 1초 폴링해 새 줄만 전송.
// 잡이 끝나면 end 이벤트를 보내고 닫는다(6-12).
import type { NextRequest } from "next/server";
import { getJob } from "@/lib/jobs";
import { getJobLogsSince } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["done", "failed", "canceled"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastId = 0;
      const encoder = new TextEncoder();

      const send = (event: string | null, data: unknown) => {
        if (closed) return;
        const prefix = event ? `event: ${event}\n` : "";
        try {
          controller.enqueue(encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`));
        } catch {
          finish();
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // 이미 닫혔으면 무시.
        }
      };

      const tick = () => {
        if (closed) return;
        if (!Number.isInteger(jobId)) {
          send("end", { error: "잡 id가 올바르지 않습니다." });
          finish();
          return;
        }
        const job = getJob(jobId);
        if (!job) {
          send("end", { error: "잡을 찾을 수 없습니다." });
          finish();
          return;
        }
        const rows = getJobLogsSince(jobId, lastId);
        for (const row of rows) {
          lastId = row.id;
          send(null, row);
        }
        if (TERMINAL_STATUSES.has(job.status)) {
          send("end", { status: job.status });
          finish();
        }
      };

      const timer = setInterval(tick, 1000);
      tick(); // 연결 직후 한 번 즉시 보낸다.

      req.signal.addEventListener("abort", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
