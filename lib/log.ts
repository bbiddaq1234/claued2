// job_logs 기록 (6장 파일구조). SSE 스트림(/api/jobs/[id]/stream)이 이 테이블을 폴링한다.
import { getDb } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error";

export interface JobLogRow {
  id: number;
  job_id: number;
  level: LogLevel;
  message: string;
  created_at: string;
}

export function jobLog(jobId: number, message: string, level: LogLevel = "info"): void {
  const db = getDb();
  db.prepare("INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)").run(
    jobId,
    level,
    message
  );
}

// SSE가 "새 줄만" 보내기 위해 afterId 이후의 로그만 가져온다.
export function getJobLogsSince(jobId: number, afterId = 0): JobLogRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, job_id, level, message, created_at FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id ASC"
    )
    .all(jobId, afterId) as JobLogRow[];
}
