// 크롤링 이미지 판정(워터마크·초상권) (6-6).
import { runClaudeJson } from "@/lib/claude";
import { CrawlVerdictSchema, type CrawlVerdict } from "@/lib/types";

export interface JudgeCrawlOpts {
  query: string; // 이 사진이 들어갈 자리의 검색어/설명 — 적합도 판정 기준
}

export async function judgeCrawlImage(imagePath: string, opts: JudgeCrawlOpts): Promise<CrawlVerdict> {
  const prompt = `
당신은 블로그에 쓸 사진을 심사하는 엄격한 검수자입니다.
이 사진은 아래 자리에 쓰일 예정입니다: "${opts.query}"

세 가지 축을 각각 판정하세요:
1. watermark — 워터마크, 사이트 로고, 저작권 표기, 서명, 스톡 사진 출처 표시가
   조금이라도 보이면 true. 의심스러우면 true로 판정하세요.
2. koreanPerson — 한국인으로 보이는 얼굴이 식별 가능하면 true(초상권 위험).
   얼굴이 안 보이거나(뒷모습·손·실루엣) 명백한 외국인 스톡 사진이면 false.
   애매하면 true로 판정하세요(안전한 쪽으로).
3. fit — watermark와 koreanPerson이 둘 다 문제없다는 전제 하에, 이 사진이
   위 자리("${opts.query}")에 주제·구도상 어울리는지.

JSON 형식: {"fit": true|false, "watermark": true|false, "koreanPerson": true|false, "reason": "판정 이유 한 문장"}
`.trim();

  const res = await runClaudeJson(prompt, CrawlVerdictSchema, { images: [imagePath] });

  // ⚠️ 판정 호출이 실패했을 때 그 이미지를 채택하면 안 된다 — claude 한도 초과가
  // "검증 안 된 이미지 통과"로 이어지지 않게 fit:false로 처리한다(6-6).
  if (!res.ok) {
    return { fit: false, watermark: false, koreanPerson: false, reason: `판정 실패: ${res.error}` };
  }

  const verdict = res.data;
  // ⚠️ watermark || koreanPerson 이면 fit을 강제로 false로 덮어쓴다.
  // AI가 fit=true로 답해도 코드에서 무시해야 한다(6-6).
  if (verdict.watermark || verdict.koreanPerson) {
    return { ...verdict, fit: false };
  }
  return verdict;
}

// 탈락 사유를 사용자가 이해할 수 있는 한국어 카테고리로 요약한다.
// DB(images.verdict_reason)에 남겨 워터마크·초상권 필터가 실제로 동작하는지
// 사용자가 확인할 수 있는 유일한 통로다(6-6).
export function categorizeCrawlRejection(verdict: CrawlVerdict): string {
  if (verdict.reason.startsWith("판정 실패")) return "판정 실패";
  if (verdict.watermark) return "워터마크";
  if (verdict.koreanPerson) return "국내 인물(초상권)";
  return "주제 불일치";
}
