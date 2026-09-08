// lib/scrape/images.ts + lib/ai/cfUsage.ts 검증용 (10-A, 계정 불필요).
// 실제 naver/google 이미지 검색은 이 세션 네트워크 정책상 막혀 있어 접속 자체는
// 검증할 수 없다. 대신 로컬 HTTP 서버로 "3000바이트 미만은 버린다"는 다운로드
// 로직과, images 테이블 기록/집계(로컬 날짜 기준, 7-22)를 검증한다.
// 실행: npx tsx scripts/verify-images.ts
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { newContext } from "../lib/playwright";
import { downloadCandidate, recordImage } from "../lib/scrape/images";
import { getDb } from "../lib/db";
import { getUsage } from "../lib/ai/cfUsage";
import { neuronsPerImage } from "../lib/ai/neurons";

const SCRATCH = "/tmp/claude-0/-home-user-claued2/3d5f9368-bd66-500a-8b34-bacb180336eb/scratchpad";

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/small") {
        res.end(Buffer.alloc(100, 1)); // 3000바이트 미만 — 버려져야 함
      } else if (req.url === "/big") {
        res.end(Buffer.alloc(5000, 2)); // 3000바이트 이상 — 저장돼야 함
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function main() {
  console.log("1) downloadCandidate() 3000바이트 미만은 버림 --------------");
  const { url, close } = await startServer();
  const { browser, context } = await newContext({ headless: true });
  try {
    const smallDest = path.join(SCRATCH, "dl-small.bin");
    const bigDest = path.join(SCRATCH, "dl-big.bin");
    fs.rmSync(smallDest, { force: true });
    fs.rmSync(bigDest, { force: true });

    const smallOk = await downloadCandidate(context, `${url}/small`, smallDest);
    const bigOk = await downloadCandidate(context, `${url}/big`, bigDest);

    assert.equal(smallOk, false, "100바이트 응답이 다운로드 성공으로 처리됨");
    assert.equal(fs.existsSync(smallDest), false, "3000바이트 미만인데 파일이 저장됨");
    assert.equal(bigOk, true, "5000바이트 응답이 실패로 처리됨");
    assert.equal(fs.statSync(bigDest).size, 5000, "저장된 파일 크기가 다름");
    console.log("  OK 100바이트→버림, 5000바이트→저장 확인");
  } finally {
    await browser.close();
    await close();
  }

  console.log("\n2) recordImage() + images 테이블 기록 -----------------------");
  const db = getDb();
  db.prepare("INSERT INTO jobs (keyword, mode) VALUES (?, ?)").run("__verify_images__", "auto");
  const jobId = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
  const id = (jobId as any).id as number;

  recordImage({
    jobId: id,
    query: "카페 인테리어",
    srcUrl: "https://example.com/a.jpg",
    localPath: "/tmp/a.jpg",
    sourceSite: "naver",
    verdictOk: false,
    verdictReason: "워터마크로 보임",
    sectionIndex: 2,
  });
  recordImage({
    jobId: id,
    query: "커피 클로즈업",
    localPath: "/tmp/b.png",
    sourceSite: "ai",
    verdictOk: true,
    verdictReason: "적합",
    sectionIndex: 3,
    genPrompt: "a cup of coffee, photorealistic photograph",
  });

  const rows = db.prepare("SELECT * FROM images WHERE job_id = ?").all(id) as any[];
  assert.equal(rows.length, 2, "images 행이 2개가 아님");
  assert.equal(rows[0].verdict_ok, 0);
  assert.equal(rows[1].verdict_ok, 1);
  assert.equal(rows[1].gen_prompt, "a cup of coffee, photorealistic photograph");
  console.log("  OK 채택/탈락 이미지 둘 다 기록됨(탈락 사유 포함)");

  console.log("\n3) cfUsage: 오늘 생성분만 집계(로컬 날짜 기준, 7-22) --------------");
  // 오늘치 1건은 위에서 이미 기록했다(source_site='ai'). 어제 날짜로 하나 더 넣어
  // 집계에서 빠지는지 확인한다.
  db.prepare(
    `INSERT INTO images (job_id, query, source_site, verdict_ok, verdict_reason, section_index, created_at)
     VALUES (?, ?, 'ai', 1, '어제 생성분', 0, datetime('now', '-1 day'))`
  ).run(id, "어제 검색어");

  const usage = await getUsage(6);
  console.log("  usage:", usage);
  assert.equal(usage.source, "estimated", "Cloudflare 키가 없는데 measured로 나옴");
  assert.equal(usage.neuronsToday, neuronsPerImage(6), "오늘치 1건 기준 뉴런 계산이 다름(어제치가 섞였을 수 있음)");
  console.log("  OK 오늘 생성분 1건만 집계됨(어제 생성분 제외)");

  db.prepare("DELETE FROM images WHERE job_id = ?").run(id);
  db.prepare("DELETE FROM jobs WHERE id = ?").run(id);

  console.log("\n모든 검증 통과");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
