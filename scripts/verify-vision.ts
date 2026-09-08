// lib/ai/vision.ts 검증용 (10-A, 계정 불필요 — claude CLI만 있으면 됨).
// 실제 인물 사진 대신, 브랜드 로고(워터마크 유사)와 사람이 없는 합성 이미지로
// "watermark||koreanPerson이면 fit을 강제로 false로 덮어쓴다"는 코드의 불변식을 검증한다.
// 실행: npx tsx scripts/verify-vision.ts
import assert from "node:assert/strict";
import path from "node:path";
import { judgeCrawlImage, categorizeCrawlRejection } from "../lib/ai/vision";

const SCRATCH = "/tmp/claude-0/-home-user-claued2/3d5f9368-bd66-500a-8b34-bacb180336eb/scratchpad";

async function main() {
  console.log("1) categorizeCrawlRejection() 순수 함수 -----------------");
  assert.equal(
    categorizeCrawlRejection({ fit: false, watermark: true, koreanPerson: false, reason: "로고 보임" }),
    "워터마크"
  );
  assert.equal(
    categorizeCrawlRejection({ fit: false, watermark: false, koreanPerson: true, reason: "얼굴 보임" }),
    "국내 인물(초상권)"
  );
  assert.equal(
    categorizeCrawlRejection({ fit: false, watermark: false, koreanPerson: false, reason: "안 어울림" }),
    "주제 불일치"
  );
  assert.equal(
    categorizeCrawlRejection({ fit: false, watermark: false, koreanPerson: false, reason: "판정 실패: 타임아웃" }),
    "판정 실패"
  );
  console.log("  OK 4가지 카테고리 분류 확인");

  console.log("\n2) judgeCrawlImage() 브랜드 로고 이미지 (워터마크 유사) ------");
  const logoPath = path.join(SCRATCH, "test-logo.png");
  const logoVerdict = await judgeCrawlImage(logoPath, { query: "카페 인테리어" });
  console.log("  verdict:", logoVerdict);
  assert.equal(typeof logoVerdict.fit, "boolean");
  assert.equal(typeof logoVerdict.watermark, "boolean");
  assert.equal(typeof logoVerdict.koreanPerson, "boolean");
  // ⚠️ 코드의 핵심 불변식: watermark나 koreanPerson이 true면 fit은 반드시 false여야 한다
  // (AI가 fit=true로 답해도 코드가 덮어쓴다).
  if (logoVerdict.watermark || logoVerdict.koreanPerson) {
    assert.equal(logoVerdict.fit, false, "watermark/koreanPerson이 true인데 fit이 강제로 false가 되지 않음");
    console.log("  OK watermark 또는 koreanPerson이 true → fit이 강제로 false로 덮어써짐");
  } else {
    console.log("  참고: 이번 판정에서는 watermark/koreanPerson이 둘 다 false로 나와 강제 로직이 발동하지 않음");
  }

  console.log("\n3) judgeCrawlImage() 사람 없는 합성 이미지 ------------------");
  const cleanPath = path.join(SCRATCH, "test-clean.png");
  const cleanVerdict = await judgeCrawlImage(cleanPath, { query: "그라데이션 배경" });
  console.log("  verdict:", cleanVerdict);
  assert.equal(typeof cleanVerdict.fit, "boolean");
  console.log("  OK 응답 스키마 확인");

  console.log("\n모든 검증 통과");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
