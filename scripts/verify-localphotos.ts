// lib/localPhotos.ts 검증용 (10-A, 계정 불필요). 실제 claude CLI로 사진 설명·매칭까지 확인한다.
// 실행: npx tsx scripts/verify-localphotos.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  expandHome,
  listLocalPhotos,
  describeLocalPhotos,
  placeInOrder,
  placeByAiMatch,
} from "../lib/localPhotos";

const SCRATCH = "/tmp/claude-0/-home-user-claued2/3d5f9368-bd66-500a-8b34-bacb180336eb/scratchpad";
const PHOTO_DIR = path.join(SCRATCH, "local-photos-test");

async function main() {
  console.log("0) 픽스처 폴더 준비 --------------------------------------");
  fs.rmSync(PHOTO_DIR, { recursive: true, force: true });
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const names = ["사진1.jpg", "사진10.jpg", "사진2.jpg", "메모.txt", "사진3.PNG"];
  for (const n of names) fs.writeFileSync(path.join(PHOTO_DIR, n), Buffer.from([0]));
  // 실제 이미지 2장은 vision 테스트용 픽스처를 복사해 쓴다(로고/그라데이션).
  fs.copyFileSync(path.join(SCRATCH, "test-logo.png"), path.join(PHOTO_DIR, "카페간판.png"));
  fs.copyFileSync(path.join(SCRATCH, "test-clean.png"), path.join(PHOTO_DIR, "배경.png"));

  console.log("1) expandHome() -------------------------------------------");
  const home = expandHome("~/사진");
  assert.ok(path.isAbsolute(home) && !home.startsWith("~"), "~ 확장이 안 됨");
  console.log(`  OK ~/사진 → ${home}`);

  console.log("\n2) listLocalPhotos() 확장자 필터 + 자연순 정렬 ------------------");
  const photos = listLocalPhotos(PHOTO_DIR);
  const baseNames = photos.map((p) => path.basename(p));
  console.log("  ", baseNames);
  assert.ok(!baseNames.includes("메모.txt"), "txt 파일이 걸러지지 않음");
  assert.ok(baseNames.includes("사진3.PNG"), "대문자 확장자(.PNG)가 걸러짐");
  const idx1 = baseNames.indexOf("사진1.jpg");
  const idx2 = baseNames.indexOf("사진2.jpg");
  const idx10 = baseNames.indexOf("사진10.jpg");
  assert.ok(idx1 < idx2 && idx2 < idx10, `자연순 정렬 실패: 사진1(${idx1}) 사진2(${idx2}) 사진10(${idx10})`);
  console.log("  OK txt 제외, 대문자 확장자 포함, 사진1<사진2<사진10 자연순 정렬 확인");

  console.log("\n3) describeLocalPhotos() 실제 claude 비전 호출 -------------------");
  const realPhotos = [path.join(PHOTO_DIR, "카페간판.png"), path.join(PHOTO_DIR, "배경.png")];
  const descs = await describeLocalPhotos(realPhotos);
  console.log("  descs:", descs);
  assert.equal(descs.length, 2, "설명 개수가 사진 개수와 다름");
  for (const d of descs) assert.ok(d.length > 0 && d.length <= 60, `설명 길이 이상: "${d}"`);
  console.log("  OK 사진 2장 각각 설명 생성됨");

  console.log("\n4) placeInOrder() 순차 배치(순수 함수) --------------------------");
  const ordered = placeInOrder(realPhotos, descs, 5);
  assert.equal(ordered.length, 2, "사진보다 많은 자리를 만들면 안 됨(사진 개수만큼만)");
  assert.equal(ordered[0].path, realPhotos[0]);
  assert.equal(ordered[1].path, realPhotos[1]);
  console.log("  OK 순서대로, 사진 개수만큼만 배치됨");

  console.log("\n5) placeByAiMatch() 실제 claude 매칭 + 폴백 불변식 ------------------");
  const captions = ["카페 간판이 보이는 입구 사진", "은은한 배경 느낌 사진", "세 번째 자리(사진 부족 예상)"];
  const matched = await placeByAiMatch(realPhotos, descs, captions);
  console.log("  matched:", matched.map((m) => path.basename(m.path)));
  assert.equal(matched.length, Math.min(realPhotos.length, captions.length), "배치 개수가 예상과 다름");
  const usedPaths = new Set(matched.map((m) => m.path));
  assert.equal(usedPaths.size, matched.length, "같은 사진이 중복 배정됨");
  console.log("  OK 자리 수/사진 수 중 작은 쪽만큼 배치, 중복 배정 없음(폴백 포함)");

  fs.rmSync(PHOTO_DIR, { recursive: true, force: true });
  console.log("\n모든 검증 통과");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
