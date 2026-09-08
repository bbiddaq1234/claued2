// lib/jobs.ts 검증용 (10-A, 계정 불필요). CRUD·발행 가드용 조회 함수를 확인한다.
// 실행: npx tsx scripts/verify-jobs.ts
import assert from "node:assert/strict";
import { getDb } from "../lib/db";
import {
  createJob,
  getJob,
  listRecentJobs,
  hasActiveJob,
  setJobStage,
  recordIdea,
  recordDraft,
  createPendingPost,
  finalizePost,
  getLastPublishedAt,
  getJobDetail,
} from "../lib/jobs";

function cleanup(jobId: number) {
  const db = getDb();
  db.prepare("DELETE FROM job_logs WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM posts WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM images WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM drafts WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM ideas WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM sources WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
}

async function main() {
  console.log("1) createJob/getJob/listRecentJobs -------------------------");
  const jobId = createJob("__verify__ 제주도 여행", "auto", true, { mode: "auto", keyword: "제주도 여행", photoSource: "none" });
  const job = getJob(jobId);
  assert.ok(job, "생성한 잡을 조회하지 못함");
  assert.equal(job!.status, "pending", "초기 status가 pending이 아님");
  assert.equal(job!.mode, "auto");
  const recent = listRecentJobs(5);
  assert.ok(recent.some((j) => j.id === jobId), "최근 목록에 방금 만든 잡이 없음");
  console.log("  OK");

  console.log("\n2) hasActiveJob() — 진행 중 잡 중복 방지(7-16) -----------------");
  assert.equal(hasActiveJob(), true, "pending 상태인데 activeJob이 아니라고 나옴");
  setJobStage(jobId, { status: "done" });
  assert.equal(hasActiveJob(), false, "done인데 여전히 activeJob이라고 나옴");
  setJobStage(jobId, { status: "pending" }); // 이후 테스트를 위해 되돌림
  console.log("  OK");

  console.log("\n3) recordIdea/recordDraft/createPendingPost/finalizePost -------");
  recordIdea(jobId, { title: "A", angle: "a", rationale: "ra" }, false);
  recordIdea(jobId, { title: "B(선택됨)", angle: "b", rationale: "rb" }, true);
  const draftId = recordDraft(jobId, null, "테스트 제목", [{ type: "paragraph", text: "본문" }]);

  const postId1 = createPendingPost(jobId, draftId);
  finalizePost(postId1, { status: "dry_run", note: "연습 모드", published: false });

  const postId2 = createPendingPost(jobId, draftId);
  finalizePost(postId2, {
    status: "published",
    blogUrl: "https://blog.naver.com/testid/223456789012",
    screenshot: "/tmp/shot.png",
    note: "발행됨",
    published: true,
  });

  const detail = getJobDetail(jobId);
  assert.equal(detail.ideas.length, 2, "글감이 2개가 아님");
  assert.equal((detail.ideas as any[]).filter((i) => i.chosen).length, 1, "선택된 글감이 1개가 아님");
  assert.equal(detail.drafts.length, 1);
  assert.equal(detail.posts.length, 2);
  const publishedPost = (detail.posts as any[]).find((p) => p.status === "published");
  assert.ok(publishedPost.published_at, "published인데 published_at이 비어 있음");
  const dryRunPost = (detail.posts as any[]).find((p) => p.status === "dry_run");
  assert.equal(dryRunPost.published_at, null, "dry_run인데 published_at이 채워짐");
  console.log("  OK 발행 성공만 published_at이 채워짐(하루 발행 수 집계 근거)");

  console.log("\n4) getLastPublishedAt() -----------------------------------");
  const last = getLastPublishedAt();
  assert.ok(last instanceof Date, "마지막 발행 시각을 못 읽음");
  const diffMin = Math.abs(Date.now() - last!.getTime()) / 60000;
  assert.ok(diffMin < 5, `방금 발행했는데 시간 차이가 너무 큼: ${diffMin}분`);
  console.log("  OK");

  cleanup(jobId);
  console.log("\n모든 검증 통과");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
