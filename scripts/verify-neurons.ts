// lib/ai/neurons.ts 검증용 (10-A, 계정 불필요, 순수 함수). 7-12의 표와 정확히 일치해야 한다.
// 실행: npx tsx scripts/verify-neurons.ts
import assert from "node:assert/strict";
import { neuronsPerImage, roundNeurons, imagesPerDay } from "../lib/ai/neurons";

const table = [
  { steps: 2, perImage: 96, perDay: 104, per5: 20 },
  { steps: 4, perImage: 173, perDay: 57, per5: 11 },
  { steps: 6, perImage: 250, perDay: 40, per5: 8 },
  { steps: 8, perImage: 326, perDay: 30, per5: 6 },
];

for (const row of table) {
  const per = neuronsPerImage(row.steps);
  const perRounded = roundNeurons(per);
  const perDay = imagesPerDay(row.steps);
  const per5 = Math.floor(perDay / 5);
  console.log(`steps=${row.steps}: 장당=${per}(반올림 ${perRounded}), 하루=${perDay}장, 5장글=${per5}편`);
  assert.equal(perRounded, row.perImage, `steps=${row.steps} 장당 단가 불일치`);
  assert.equal(perDay, row.perDay, `steps=${row.steps} 하루 장수 불일치`);
  assert.equal(per5, row.per5, `steps=${row.steps} 5장짜리 글 편수 불일치`);
}

// 실측 검증: 6스텝, 31장 = 7,738 ÷ 31 = 249.6(오차 0.4)
const measured = 7738 / 31;
assert.ok(Math.abs(neuronsPerImage(6) - measured) < 0.5, "6스텝 실측값과 오차가 너무 큼");

// 반환값이 정수가 아님을 확인(계량기 표시 버그 방지)
assert.ok(!Number.isInteger(neuronsPerImage(6)), "neuronsPerImage가 정수를 반환함 — 소수점이 사라짐");

console.log("\nOK: 7-12 표와 전부 일치");
