// lib/pipeline.ts 검증용 (10-A, 계정 불필요 — 발행 단계는 제외).
// fillImages()의 소스별 분기(none/local/ai/crawl)와 pickContextSnippets()를 확인한다.
// ⚠️ 발행 단계(publishStage)는 실제 네이버 접속이 필요해 여기서 검증하지 않는다
// — naver/publish.ts 자체는 6.5-a 하네스(scripts/verify-publish.ts)로 이미
// 충분히 검증했고, 여기서는 그 앞단(수집~이미지)의 배선만 확인한다.
// 실행: npx tsx scripts/verify-pipeline.ts
import assert from "node:assert/strict";
import path from "node:path";
import { getDb } from "../lib/db";
import { createJob, recordDraft } from "../lib/jobs";
import { fillImages, pickContextSnippets } from "../lib/pipeline";
import type { Draft, Section } from "../lib/types";
import { getSettings } from "../lib/settings";

const SCRATCH = "/tmp/claude-0/-home-user-claued2/3d5f9368-bd66-500a-8b34-bacb180336eb/scratchpad";

function cleanup(jobId: number) {
  const db = getDb();
  db.prepare("DELETE FROM job_logs WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM images WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM drafts WHERE job_id=?").run(jobId);
  db.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
}

async function main() {
  console.log("1) pickContextSnippets() 순수 함수 -----------------------------");
  const sections: Section[] = [
    { type: "heading", text: "소제목1" },
    { type: "paragraph", text: "문단1 내용입니다" },
    { type: "image", query: "q" },
    { type: "paragraph", text: "문단2 내용입니다" },
    { type: "paragraph", text: "문단3 내용입니다" },
  ];
  const snippets = pickContextSnippets(sections, 2);
  console.log("  snippets:", snippets);
  assert.ok(snippets.length <= 2, "문맥 스니펫이 2개를 넘음");
  assert.ok(snippets.length > 0, "문맥 스니펫이 하나도 없음");
  console.log("  OK");

  const settings = getSettings();

  console.log("\n2) fillImages() photoSource=none — 즉시 빈 결과 -----------------");
  const jobIdNone = createJob("__verify_pipeline_none__", "auto", true, {});
  const draftNone: Draft = { title: "t", sections: [{ type: "paragraph", text: "p" }] };
  const draftIdNone = recordDraft(jobIdNone, null, draftNone.title, draftNone.sections);
  const resultNone = await fillImages(jobIdNone, draftIdNone, draftNone, {
    photoSource: "none",
    imageStyle: "photo",
    photos: [],
    photoDescs: [],
    placementMode: "order",
    settings,
  });
  assert.deepEqual(resultNone, {}, "photoSource=none인데 결과가 비어있지 않음");
  cleanup(jobIdNone);
  console.log("  OK");

  console.log("\n3) fillImages() photoSource=local — 2장 순서대로 배치 -----------------");
  const jobIdLocal = createJob("__verify_pipeline_local__", "auto", true, {});
  const draftLocal: Draft = {
    title: "로컬 사진 테스트",
    sections: [
      { type: "paragraph", text: "문단" },
      { type: "image", query: "카페 간판 사진", caption: "카페 간판 사진" },
      { type: "paragraph", text: "문단2" },
      { type: "image", query: "배경 사진", caption: "배경 사진" },
    ],
  };
  const draftIdLocal = recordDraft(jobIdLocal, null, draftLocal.title, draftLocal.sections);
  const photos = [path.join(SCRATCH, "test-logo.png"), path.join(SCRATCH, "test-clean.png")];
  const resultLocal = await fillImages(jobIdLocal, draftIdLocal, draftLocal, {
    photoSource: "local",
    imageStyle: "photo",
    photos,
    photoDescs: ["카페 간판이 보이는 사진", "단색 배경 사진"],
    placementMode: "order",
    settings,
  });
  console.log("  result:", resultLocal);
  assert.equal(Object.keys(resultLocal).length, 2, "local 2장인데 배치 결과가 2개가 아님");
  assert.equal(resultLocal[1], photos[0], "order 배치인데 첫 자리에 첫 사진이 안 옴");
  assert.equal(resultLocal[3], photos[1], "order 배치인데 둘째 자리에 둘째 사진이 안 옴");
  const localImageRows = getDb().prepare("SELECT * FROM images WHERE job_id=?").all(jobIdLocal) as any[];
  assert.equal(localImageRows.length, 2, "images 테이블에 로컬 사진 2건이 기록되지 않음");
  assert.ok(localImageRows.every((r) => r.source_site === "local" && r.verdict_ok === 1));
  cleanup(jobIdLocal);
  console.log("  OK 배치 결과 + images 테이블 기록 확인");

  console.log("\n4) fillImages() photoSource=ai — 열쇠 없어 전부 실패, 그래도 안 죽음 -----------------");
  const jobIdAi = createJob("__verify_pipeline_ai__", "auto", true, {});
  const draftAi: Draft = {
    title: "AI 이미지 테스트",
    sections: [
      { type: "paragraph", text: "커피 이야기입니다" },
      { type: "image", query: "커피 클로즈업", caption: "커피 클로즈업" },
      { type: "paragraph", text: "마무리 문단입니다" },
    ],
  };
  const draftIdAi = recordDraft(jobIdAi, null, draftAi.title, draftAi.sections);
  const resultAi = await fillImages(jobIdAi, draftIdAi, draftAi, {
    photoSource: "ai",
    imageStyle: "photo",
    photos: [],
    photoDescs: [],
    placementMode: "order",
    settings: { ...settings, cfImageSteps: 6 },
  });
  console.log("  result:", resultAi);
  assert.deepEqual(resultAi, {}, "Cloudflare 열쇠가 없는데 결과가 채워짐");
  const aiImageRows = getDb().prepare("SELECT * FROM images WHERE job_id=?").all(jobIdAi) as any[];
  console.log(`  기록된 시도 ${aiImageRows.length}건(전부 실패, genPrompt는 남아야 함)`);
  assert.ok(aiImageRows.length >= 1, "실패한 시도가 기록되지 않음");
  assert.ok(aiImageRows.every((r) => r.verdict_ok === 0), "열쇠 없이 생성됐다고 기록됨");
  assert.ok(aiImageRows.every((r) => r.gen_prompt), "gen_prompt가 기록되지 않음");
  cleanup(jobIdAi);
  console.log("  OK 실패해도 파이프라인이 죽지 않고, 시도가 전부 기록됨");

  console.log("\n5) fillImages() photoSource=crawl — 네트워크 차단 상황에서도 안 죽음 -----------------");
  const jobIdCrawl = createJob("__verify_pipeline_crawl__", "auto", true, {});
  const draftCrawl: Draft = {
    title: "크롤링 이미지 테스트",
    sections: [{ type: "image", query: "제주도 풍경" }],
  };
  const draftIdCrawl = recordDraft(jobIdCrawl, null, draftCrawl.title, draftCrawl.sections);
  const resultCrawl = await fillImages(jobIdCrawl, draftIdCrawl, draftCrawl, {
    photoSource: "crawl",
    imageStyle: "photo",
    photos: [],
    photoDescs: [],
    placementMode: "order",
    settings: { ...settings, imageCandidates: 3 },
  });
  console.log("  result:", resultCrawl);
  assert.deepEqual(resultCrawl, {}, "이 세션은 네이버/구글 접속이 막혀 있는데 결과가 채워짐");
  cleanup(jobIdCrawl);
  console.log("  OK 크롤링 접속이 전부 실패해도 예외 없이 빈 결과로 넘어감");

  console.log("\n모든 검증 통과(crawl/ai의 '정상 채택' 경로는 사용자 환경에서 네트워크·열쇠로 확인 필요, 8-2)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
