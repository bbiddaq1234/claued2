// lib/ai/imagegen.ts 검증용 (10-A, 계정 불필요).
// Cloudflare 실제 생성 호출은 이 세션 네트워크 정책상 접속이 막혀 있어 검증할 수
// 없다(사용자 환경에서 열쇠를 넣은 뒤 확인해야 함, 8-2). 여기서는 ① 프롬프트 설계
// (claude -p만 필요) ② 열쇠 없을 때의 에러 처리 두 가지를 확인한다.
// 실행: npx tsx scripts/verify-imagegen.ts
import assert from "node:assert/strict";
import { designImagePrompt, generateImageCF } from "../lib/ai/imagegen";

async function main() {
  console.log("1) designImagePrompt() photo 스타일 -------------------------");
  const p1 = await designImagePrompt({
    title: "동네 조용한 북카페 후기",
    caption: "창가 자리에서 찍은 사진",
    contextSnippets: ["창가 자리는 햇빛이 잘 들어서 낮에 가면 특히 좋아요."],
    style: "photo",
  });
  assert.ok(p1.ok, `실패: ${!p1.ok && p1.error}`);
  if (p1.ok) {
    console.log("  prompt:", p1.prompt);
    assert.ok(/photorealistic photograph/i.test(p1.prompt), "photo 스타일 토큰이 없음");
    assert.ok(/no watermark/i.test(p1.prompt), "금지 접미사가 없음");
    const wordCount = p1.prompt.split(/\s+/).length;
    console.log(`  단어 수: ${wordCount}`);
  }

  console.log("\n2) designImagePrompt() illust 스타일 -------------------------");
  const p2 = await designImagePrompt({
    title: "1인 마케팅 컨설팅",
    contextSnippets: ["고객 여정 3단계 진단 프레임워크를 소개합니다."],
    style: "illust",
  });
  assert.ok(p2.ok, `실패: ${!p2.ok && p2.error}`);
  if (p2.ok) {
    console.log("  prompt:", p2.prompt);
    assert.ok(/flat vector illustration/i.test(p2.prompt), "illust 스타일 토큰이 없음");
    assert.ok(/no watermark/i.test(p2.prompt), "금지 접미사가 없음");
  }

  console.log("\n3) generateImageCF() 열쇠 없을 때 에러 처리 -------------------");
  const g = await generateImageCF("a cup of coffee", 6);
  assert.equal(g.ok, false);
  if (!g.ok) {
    console.log("  error:", g.error);
    assert.ok(g.error.includes("Cloudflare"), "열쇠 없음 에러 메시지가 아님");
  }

  console.log("\n모든 검증 통과(실제 Cloudflare 생성/검증 3단계는 사용자 환경에서 열쇠로 확인 필요)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
