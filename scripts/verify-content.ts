// lib/ai/content.ts + templates.ts 검증용 (10-A, 계정 불필요 — claude CLI만 있으면 됨).
// 실제 claude -p를 호출하므로 시간이 걸린다(글감 1회 + 초안 4회).
// 실행: npx tsx scripts/verify-content.ts
import assert from "node:assert/strict";
import { generateIdeas, generateDraft, sanitizeDraft, type SourceLike } from "../lib/ai/content";
import { generateExperienceDraft, generateBrandingDraft } from "../lib/ai/templates";
import type { Draft } from "../lib/types";

const MARKDOWN_LEAK = /\*\*|~~|(?<!\d)~(?!\d)|(^|\n)\s*#{1,6}\s|(^|\n)\s*>\s|`|(^|\n)\s*[-*+]\s/;

function allTexts(draft: Draft): string[] {
  return draft.sections.flatMap((s) => {
    if (s.type === "heading" || s.type === "quote") return [s.text];
    if (s.type === "paragraph") return [s.text];
    if (s.type === "image") return s.caption ? [s.caption] : [];
    return [];
  });
}

function imageCount(draft: Draft): number {
  return draft.sections.filter((s) => s.type === "image").length;
}

function checkNoMarkdown(label: string, draft: Draft) {
  const leaks = allTexts(draft).filter((t) => MARKDOWN_LEAK.test(t));
  if (leaks.length) {
    console.warn(`  ⚠️ [${label}] 마크다운 기호로 보이는 텍스트 ${leaks.length}건:`, leaks.slice(0, 3));
  } else {
    console.log(`  OK [${label}] 마크다운 유출 0건`);
  }
}

function checkHighlights(label: string, draft: Draft) {
  const { draft: sanitized, droppedHighlights } = sanitizeDraft(draft);
  console.log(`  [${label}] highlight 지어냄으로 버려진 개수: ${droppedHighlights}`);
  for (const s of sanitized.sections) {
    if (s.type === "paragraph" && s.highlight) {
      assert.ok(s.text.includes(s.highlight), `sanitizeDraft 이후에도 highlight가 본문에 없음: ${s.highlight}`);
    }
  }
  console.log(`  OK [${label}] 남은 highlight는 전부 본문에 글자 그대로 있음`);
}

async function main() {
  console.log("1) generateIdeas() ---------------------------------");
  const sources: SourceLike[] = [
    { type: "news", title: "제주 감귤 풍년, 역대 최고 수확량", summary: "제주 지역 감귤 농가들이 올해 역대급 수확량을 기록했다." },
    { type: "blog", title: "제주도 감성 카페 추천 베스트5", summary: "조용히 커피 마시기 좋은 제주 카페들을 모아봤어요." },
  ];
  const ideasRes = await generateIdeas("제주도 여행", sources, 5);
  assert.ok(ideasRes.ok, `generateIdeas 실패: ${!ideasRes.ok && ideasRes.error}`);
  if (ideasRes.ok) {
    assert.ok(ideasRes.data.ideas.length >= 3, "글감이 3개 미만");
    console.log(`  OK 글감 ${ideasRes.data.ideas.length}개:`, ideasRes.data.ideas.map((i) => i.title));
  }
  const idea = ideasRes.ok ? ideasRes.data.ideas[0] : { title: "제주도 여행", angle: "숨은 명소", rationale: "테스트" };

  console.log("\n2) generateDraft() photoSource=none (auto, 이미지 0개 강제) --------");
  const dNone = await generateDraft("제주도 여행", idea, sources, { photoSource: "none" });
  assert.ok(dNone.ok, `실패: ${!dNone.ok && dNone.error}`);
  if (dNone.ok) {
    assert.equal(imageCount(dNone.data), 0, "photoSource=none인데 image 섹션이 있음");
    console.log(`  OK 섹션 ${dNone.data.sections.length}개, 이미지 0개 확인`);
    checkNoMarkdown("auto/none", dNone.data);
    checkHighlights("auto/none", dNone.data);
  }

  console.log("\n3) generateDraft() photoSource=crawl (auto, 이미지 6개 이상 강제) --------");
  const dCrawl = await generateDraft("제주도 여행", idea, sources, { photoSource: "crawl" });
  assert.ok(dCrawl.ok, `실패: ${!dCrawl.ok && dCrawl.error}`);
  if (dCrawl.ok) {
    assert.ok(imageCount(dCrawl.data) >= 6, `이미지가 6개 미만: ${imageCount(dCrawl.data)}`);
    console.log(`  OK 섹션 ${dCrawl.data.sections.length}개, 이미지 ${imageCount(dCrawl.data)}개(>=6) 확인`);
    checkNoMarkdown("auto/crawl", dCrawl.data);
    checkHighlights("auto/crawl", dCrawl.data);
  }

  console.log("\n4) generateExperienceDraft() photoSource=local, 3장 (정확히 N개 강제) --------");
  const dExp = await generateExperienceDraft(
    "동네 조용한 북카페",
    "이름: 책방골목 / 위치: 연남동 / 가격: 아메리카노 5000원 / 특징: 반려동물 동반 가능, 창가 자리 추천",
    "local",
    3,
    ["창가 자리에서 찍은 사진", "아메리카노 클로즈업", "간판 사진"]
  );
  assert.ok(dExp.ok, `실패: ${!dExp.ok && dExp.error}`);
  if (dExp.ok) {
    assert.equal(imageCount(dExp.data), 3, `local 3장인데 image 섹션이 ${imageCount(dExp.data)}개`);
    console.log(`  OK 섹션 ${dExp.data.sections.length}개, 이미지 정확히 3개 확인`);
    checkNoMarkdown("experience/local", dExp.data);
    checkHighlights("experience/local", dExp.data);
  }

  console.log("\n5) generateBrandingDraft() photoSource=ai (이미지 6개 이상 강제) --------");
  const dBrand = await generateBrandingDraft(
    "1인 마케팅 컨설팅",
    "실적: 3년간 42개 소상공인 브랜드 컨설팅, 평균 매출 27% 증가. 핵심 방법론: 고객 여정 3단계 진단.",
    "ai",
    0
  );
  assert.ok(dBrand.ok, `실패: ${!dBrand.ok && dBrand.error}`);
  if (dBrand.ok) {
    assert.ok(imageCount(dBrand.data) >= 6, `이미지가 6개 미만: ${imageCount(dBrand.data)}`);
    console.log(`  OK 섹션 ${dBrand.data.sections.length}개, 이미지 ${imageCount(dBrand.data)}개(>=6) 확인`);
    checkNoMarkdown("branding/ai", dBrand.data);
    checkHighlights("branding/ai", dBrand.data);
  }

  console.log("\n모든 검증 통과");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
