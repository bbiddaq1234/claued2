// 검증 스크립트를 전부 순서대로 실행한다(10-A, 계정 불필요).
// ⚠️ claude CLI를 여러 번 호출하므로 몇 분 걸릴 수 있다. 네이버 로그인이 필요한
// 항목(10-B)은 여기 포함되지 않는다 — 그건 사용자가 로그인한 뒤에만 확인할 수 있다.
// 실행: npm run verify
import { spawn } from "node:child_process";
import path from "node:path";

const SCRIPTS = [
  "verify-claude.ts",
  "verify-playwright.ts",
  "verify-trends.ts",
  "verify-neurons.ts",
  "verify-vision.ts",
  "verify-images.ts",
  "verify-imagegen.ts",
  "verify-content.ts",
  "verify-localphotos.ts",
  "verify-jobs.ts",
  "verify-pipeline.ts",
  "verify-publish.ts",
];

function run(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n\x1b[1m▶ ${script}\x1b[0m`);
    const p = spawn("npx", ["tsx", path.join("scripts", script)], {
      stdio: "inherit",
      cwd: path.resolve(__dirname, ".."),
    });
    p.on("close", (code) => resolve(code === 0));
  });
}

async function main() {
  const results: Array<{ script: string; ok: boolean }> = [];
  for (const script of SCRIPTS) {
    const ok = await run(script);
    results.push({ script, ok });
    if (!ok) {
      console.error(`\n✗ ${script} 실패 — 나머지는 건너뜁니다.`);
      break;
    }
  }

  console.log("\n\n=== 요약 ===");
  for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.script}`);

  const allOk = results.length === SCRIPTS.length && results.every((r) => r.ok);
  if (!allOk) {
    console.log(`\n계정 없이 확인 가능한 항목(10-A) 일부가 실패했습니다.`);
  } else {
    console.log(`\n계정 없이 확인 가능한 항목(10-A)을 전부 통과했습니다.`);
    console.log(`남은 항목(10-B: 네이버 로그인 이후)은 사용자가 로그인한 뒤에만 확인할 수 있습니다.`);
  }
  process.exit(allOk ? 0 : 1);
}

main();
