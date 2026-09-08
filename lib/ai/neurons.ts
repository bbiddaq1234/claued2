// Cloudflare 단가 계산 — 서버·클라이언트 공용 순수 함수 (6-7).
//
// ⚠️ 스텝 요금은 이미지 1장이 아니라 "타일마다" 붙는다(7-12).
//   틀림: tiles*4.8 + steps*9.6
//   맞음: tiles*(4.8 + steps*9.6)   ← 실측 7,738뉴런 ÷ 31장 = 249.6(6스텝, 오차 0.4)
export function neuronsPerImage(steps: number, size = 1024): number {
  const tiles = Math.max(1, Math.round((size / 512) * (size / 512)));
  const clampedSteps = Math.min(Math.max(steps, 1), 8);
  return tiles * (4.8 + clampedSteps * 9.6);
}

// ⚠️ 반환값은 정수가 아니다(6스텝=249.6). 계산은 실수로 하고, 화면에 표시할 때만
// Math.round() 하라 — 그렇지 않으면 계량기에 소수점이 뜬다.
export function roundNeurons(n: number): number {
  return Math.round(n);
}

export function imagesPerDay(steps: number, dailyFreeNeurons = 10_000, size = 1024): number {
  const perImage = neuronsPerImage(steps, size);
  return Math.floor(dailyFreeNeurons / perImage);
}
