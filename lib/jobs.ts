// jobs/sources/ideas/drafts/posts 테이블 CRUD — pipeline.ts와 API 라우트가 공용으로 쓴다.
import { getDb } from "@/lib/db";

export interface JobRow {
  id: number;
  keyword: string;
  status: string;
  stage: string;
  auto: number;
  mode: string;
  inputs: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function createJob(keyword: string, mode: string, auto: boolean, inputs: unknown): number {
  const info = getDb()
    .prepare("INSERT INTO jobs (keyword, mode, auto, inputs) VALUES (?, ?, ?, ?)")
    .run(keyword, mode, auto ? 1 : 0, JSON.stringify(inputs));
  return Number(info.lastInsertRowid);
}

export function getJob(id: number): JobRow | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}

export function listRecentJobs(limit = 30): JobRow[] {
  return getDb().prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit) as JobRow[];
}

// ⚠️ 진행 중 잡이 있으면 409로 막는다 — 버튼 연타·SSE 재연결로 같은 잡이
// 두 번 만들어지는 것을 방지한다(7-16).
const ACTIVE_STATUSES = ["pending", "scraping", "writing", "imaging", "publishing"];
export function hasActiveJob(): boolean {
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
  const row = getDb()
    .prepare(`SELECT COUNT(*) as cnt FROM jobs WHERE status IN (${placeholders})`)
    .get(...ACTIVE_STATUSES) as { cnt: number };
  return row.cnt > 0;
}

export function setJobStage(id: number, patch: { status?: string; stage?: string; error?: string | null }): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.stage !== undefined) {
    fields.push("stage = ?");
    values.push(patch.stage);
  }
  if (patch.error !== undefined) {
    fields.push("error = ?");
    values.push(patch.error);
  }
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function recordIdea(
  jobId: number,
  idea: { title: string; angle: string; rationale: string },
  chosen: boolean
): number {
  const info = getDb()
    .prepare("INSERT INTO ideas (job_id, title, angle, rationale, chosen) VALUES (?, ?, ?, ?, ?)")
    .run(jobId, idea.title, idea.angle, idea.rationale, chosen ? 1 : 0);
  return Number(info.lastInsertRowid);
}

export function recordDraft(jobId: number, ideaId: number | null, title: string, sections: unknown): number {
  const info = getDb()
    .prepare("INSERT INTO drafts (job_id, idea_id, title, body_json) VALUES (?, ?, ?, ?)")
    .run(jobId, ideaId, title, JSON.stringify(sections));
  return Number(info.lastInsertRowid);
}

export function createPendingPost(jobId: number, draftId: number): number {
  const info = getDb()
    .prepare("INSERT INTO posts (job_id, draft_id, status) VALUES (?, ?, 'pending')")
    .run(jobId, draftId);
  return Number(info.lastInsertRowid);
}

export function finalizePost(
  postId: number,
  patch: { status: string; blogUrl?: string | null; screenshot?: string | null; note: string; published: boolean }
): void {
  // published_at은 실제로 발행됐을 때만 채운다(하루 발행 수 집계의 근거, 6-10).
  const sql = patch.published
    ? "UPDATE posts SET status=?, blog_url=?, screenshot=?, note=?, published_at=datetime('now') WHERE id=?"
    : "UPDATE posts SET status=?, blog_url=?, screenshot=?, note=? WHERE id=?";
  getDb()
    .prepare(sql)
    .run(patch.status, patch.blogUrl ?? null, patch.screenshot ?? null, patch.note, postId);
}

// ⚠️ datetime('now')는 UTC다. 여기서는 절대 시각 비교(발행 간격 분 단위)이므로
// UTC 그대로 파싱해도 안전하다 — localtime 변환이 필요한 건 "오늘 며칠"처럼
// 날짜 단위 집계일 때뿐이다(7-22, lib/ai/cfUsage.ts의 publishedToday 참조).
export function getLastPublishedAt(): Date | null {
  const row = getDb()
    .prepare("SELECT published_at FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 1")
    .get() as { published_at: string | null } | undefined;
  if (!row?.published_at) return null;
  return new Date(row.published_at.replace(" ", "T") + "Z");
}

export function getJobDetail(id: number) {
  const db = getDb();
  return {
    job: getJob(id),
    sources: db.prepare("SELECT * FROM sources WHERE job_id=? ORDER BY id").all(id),
    ideas: db.prepare("SELECT * FROM ideas WHERE job_id=? ORDER BY id").all(id),
    drafts: db.prepare("SELECT * FROM drafts WHERE job_id=? ORDER BY id").all(id),
    images: db.prepare("SELECT * FROM images WHERE job_id=? ORDER BY id").all(id),
    posts: db.prepare("SELECT * FROM posts WHERE job_id=? ORDER BY id").all(id),
  };
}
