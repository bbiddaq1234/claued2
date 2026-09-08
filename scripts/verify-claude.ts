// lib/claude.ts 검증용 (10-A, 계정 불필요 — claude CLI 로그인만 있으면 됨).
// 실행: npx tsx scripts/verify-claude.mts
import { z } from "zod";
import { checkClaude, runClaude, runClaudeJson, extractJson } from "../lib/claude";

async function main() {
  console.log("1) checkClaude() ---------------------------------");
  const status = await checkClaude();
  console.log(status);
  if (!status.installed) {
    console.error("claude CLI가 설치/로그인 되어 있지 않아 이후 테스트를 건너뜁니다.");
    process.exit(1);
  }

  console.log("\n2) runClaude() 기본 텍스트 -------------------------");
  const r1 = await runClaude("숫자 3 더하기 4는 얼마야? 숫자만 답해.");
  console.log(r1);

  console.log("\n3) runClaude() 긴 한글(2000자 이상) 안 깨지는지 ------");
  const longKo = "안녕하세요, 이것은 긴 한글 문장 테스트입니다. ".repeat(80);
  console.log("입력 길이:", longKo.length);
  const r2 = await runClaude(`아래 문장을 한 문장으로 요약해줘.\n\n${longKo}`);
  console.log({ ok: r2.ok, textLen: r2.ok ? r2.text.length : undefined, preview: r2.ok ? r2.text.slice(0, 80) : (r2 as any).error });

  console.log("\n4) extractJson() 코드펜스/순수 JSON 둘 다 --------------");
  console.log(extractJson("설명입니다\n```json\n{\"a\":1}\n```\n끝"));
  console.log(extractJson("앞에 말\n[1,2,3]\n뒤에 말"));

  console.log("\n5) runClaudeJson() 구조화 출력 + zod 검증 ---------------");
  const schema = z.object({ ideas: z.array(z.string()).min(3) });
  const r3 = await runClaudeJson(
    "여행 관련 블로그 글감 3개를 JSON으로 줘. 형식: {\"ideas\": [\"...\", \"...\", \"...\"]}",
    schema
  );
  console.log(r3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
