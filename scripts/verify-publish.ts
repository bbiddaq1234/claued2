// naver/publish.ts 검증용 (9장 6.5-a 로컬 하네스, 계정 불필요).
// 실제 네이버 대신 scripts/harness/pages.ts의 가짜 에디터로 "입력 순서"를 검증한다.
// ⚠️ 여기서 확인하는 건 순서/로직이다. 서식(형광펜 등)의 시각적 정확성은
// 하네스로 증명할 수 없다(9장 6.5-a 경고) — 실제 검증은 6.5-b(로그인 후)에서 한다.
// 실행: npx tsx scripts/verify-publish.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Page, FrameLocator } from "playwright";
import { publishToNaver, checkPublishGuard } from "../lib/naver/publish";
import type { Section } from "../lib/types";
import { buildInnerHtml, buildOuterHtml } from "./harness/pages";

const SCRATCH = "/tmp/claude-0/-home-user-claued2/3d5f9368-bd66-500a-8b34-bacb180336eb/scratchpad";

type HnEvent = { name: string; detail: string; t: number };

function pngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (req.url === "/") return res.end(buildOuterHtml("/inner.html"));
      if (req.url === "/broken") return res.end(buildOuterHtml("/inner-broken.html"));
      if (req.url === "/inner.html") return res.end(buildInnerHtml());
      if (req.url === "/inner-broken.html") return res.end(buildInnerHtml({ breakBody: true }));
      res.statusCode = 404;
      res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function makeBeforeNavigate(events: HnEvent[]) {
  return async (page: Page) => {
    await page.exposeFunction("__hnEvent", (name: string, detail: string) => {
      events.push({ name, detail, t: Date.now() });
    });
  };
}

function countEvents(events: HnEvent[], name: string): number {
  return events.filter((e) => e.name === name).length;
}

// escapeCursor의 마우스 클릭이 실제로 몇 번, 어떤 좌표에서 일어났는지 집계한다.
// ⚠️ "안전한 y"의 절대 기준값(예: 280)을 여기 하드코딩하지 않는다 — 검색바의
// 실제 페이지 기준 위치는 스크롤에 따라 달라질 수 있다(escapeCursor 주석 참조).
// 클릭이 실제로 검색바를 건드렸는지의 "그라운드 트루스"는 bottom-search-focused/
// bottom-search-input 이벤트 카운트로 별도 검증한다.
function checkEscapeClicksHappened(events: HnEvent[]): { checked: number; maxY: number } {
  let checked = 0;
  let maxY = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name !== "new-paragraph-created") continue;
    for (let j = i - 1; j >= 0; j--) {
      if (events[j].name === "click-at") {
        const { y } = JSON.parse(events[j].detail);
        maxY = Math.max(maxY, y);
        checked++;
        break;
      }
    }
  }
  return { checked, maxY };
}

function verifyPublishGuard() {
  console.log("=== 0) checkPublishGuard() 발행 가드 3종 (순수 함수) ===");
  const base = { killSwitch: false, dailyPublishLimit: 3, minPublishIntervalMin: 30 };

  const killed = checkPublishGuard({ ...base, killSwitch: true }, 0, null);
  assert.equal(killed.blocked, true, "kill switch가 막지 않음");

  const overLimit = checkPublishGuard(base, 3, null);
  assert.equal(overLimit.blocked, true, "하루 한도 초과가 막지 않음");
  const underLimit = checkPublishGuard(base, 2, null);
  assert.equal(underLimit.blocked, false, "하루 한도 미만인데 막힘");

  const tooSoon = checkPublishGuard(base, 0, new Date(Date.now() - 5 * 60_000));
  assert.equal(tooSoon.blocked, true, "발행 간격 5분인데 막지 않음(기준 30분)");
  const longEnough = checkPublishGuard(base, 0, new Date(Date.now() - 40 * 60_000));
  assert.equal(longEnough.blocked, false, "발행 간격 40분인데 막힘(기준 30분)");

  const ok = checkPublishGuard(base, 0, null);
  assert.equal(ok.blocked, false, "정상 상태인데 막힘");

  console.log("  OK kill-switch/하루한도/최소간격 3종 모두 확인");
}

async function main() {
  verifyPublishGuard();

  const { base, close } = await startServer();

  try {
    console.log("=== 시나리오 1: 연습 모드(dryRun) — 정상 하네스, 전체 섹션 타입 ===");
    const events1: HnEvent[] = [];
    let capturedHtml = "";
    let capturedParagraphTexts: string[] = [];
    let capturedCaptionText = "";
    let sidebarHiddenAfterClose = false;

    const warn = String.fromCodePoint(0x26a0);
    const vs16 = String.fromCodePoint(0xfe0f);
    const heart = String.fromCodePoint(0x2764);
    const vs16Text = `주의${warn}${vs16} 하세요 진짜${heart}${vs16} 좋아요`;
    const markdownDirty =
      "이 문장은 **강조**와 ~~취소선처럼 보이는 것~~과 `코드`를 포함하고, 물결표~도 있어요";

    const sections: Section[] = [
      { type: "heading", text: "첫 번째 소제목" },
      { type: "paragraph", text: "이 문단은 평범합니다. 오늘 날씨가 참 좋네요." },
      { type: "quote", text: "이것은 인용구 한 줄입니다" },
      { type: "paragraph", text: "인용구 다음에 오는 문단입니다. 여기 텍스트가 인용구 밖에 있어야 합니다." },
      { type: "divider" },
      { type: "paragraph", text: "구분선 다음 문단입니다." },
      { type: "image", query: "카페", caption: "사진 설명입니다" },
      { type: "paragraph", text: markdownDirty },
      { type: "paragraph", text: vs16Text },
      { type: "paragraph", text: "마지막 문단, 여기서 끝." },
    ];

    const result1 = await publishToNaver(
      {
        jobId: 1,
        title: "테스트 제목입니다",
        sections,
        imagePaths: { 6: path.join(SCRATCH, "test-clean.png") },
        visibility: "private",
        dryRun: true,
        entryUrl: `${base}/`,
        headless: true,
        beforeNavigate: makeBeforeNavigate(events1),
        afterSectionsTyped: async (_page: Page, frame: FrameLocator) => {
          capturedHtml = await frame
            .locator("#seContent")
            .evaluate((el) => el.innerHTML)
            .catch(() => "");
          capturedParagraphTexts = await frame
            .locator("#seContent")
            .evaluate((el) =>
              Array.from(el.querySelectorAll(".se-text-paragraph, blockquote")).map((e) => e.textContent || "")
            )
            .catch(() => []);
          capturedCaptionText = await frame
            .locator(".se-caption")
            .first()
            .textContent()
            .catch(() => "") || "";
        },
        afterOverlaysClosed: async (_page: Page, frame: FrameLocator) => {
          const style = await frame
            .locator("#sidebar")
            .evaluate((el) => (el as HTMLElement).style.display)
            .catch(() => "");
          sidebarHiddenAfterClose = style === "none";
        },
      },
      (msg, level) => console.log(`  [${level ?? "info"}] ${msg}`)
    );

    console.log("  result:", result1);
    console.log(
      "  이벤트 로그:",
      events1
        .filter((e) => e.name !== "click-at")
        .map((e) => `${e.name}${e.detail ? "(" + e.detail.slice(0, 40) + ")" : ""}`)
    );
    assert.equal(result1.status, "dry_run", "연습 모드인데 dry_run이 아님");
    assert.ok(result1.screenshotPath && fs.existsSync(result1.screenshotPath), "스크린샷 파일이 없음");

    // 7-20: 뷰포트가 문서 높이만큼 커진 뒤 찍혔는지 — 원래 900보다 커야 한다.
    const dim = pngDimensions(result1.screenshotPath!);
    console.log(`  screenshot size: ${dim.width}x${dim.height}`);
    assert.ok(dim.height > 900, `스크린샷 높이가 900을 넘지 않음(뷰포트 확장 안 됨): ${dim.height}`);

    // 7-1: 취소선 버튼 0회
    assert.equal(countEvents(events1, "strikethrough-clicked"), 0, "취소선 버튼이 눌림(7-1)");
    // 7-3: 팝업 취소 1회(차단막 제거 포함, publish.ts가 stuck을 반환하지 않았으므로 성공)
    assert.equal(countEvents(events1, "popup-cancelled"), 1, "복원 팝업 취소가 처리되지 않음");
    // 7-7: 파일 선택창(이미지 1장) 처리됨
    assert.equal(countEvents(events1, "file-uploaded"), 1, "이미지 업로드가 처리되지 않음");
    // 7-6: 하단 검색바에 타이핑/포커스가 전혀 새지 않음
    assert.equal(countEvents(events1, "bottom-search-focused"), 0, "타이핑이 하단 검색바로 샘(포커스)");
    assert.equal(countEvents(events1, "bottom-search-input"), 0, "타이핑이 하단 검색바로 샘(입력)");
    // dryRun은 발행 버튼 자체를 누르지 않는다(8단계에서 종료)
    assert.equal(countEvents(events1, "publish-open-clicked"), 0, "연습 모드인데 발행 버튼을 눌렀음");
    assert.equal(countEvents(events1, "confirm-clicked"), 0, "연습 모드인데 확인 버튼을 눌렀음");
    // 7-2: 예약 발행 데코이 버튼 0회
    assert.equal(countEvents(events1, "reserve-decoy-clicked"), 0, "예약 발행 0건 버튼이 눌림(7-2)");

    const { checked, maxY } = checkEscapeClicksHappened(events1);
    console.log(`  탈출 클릭 ${checked}회 검사, 최대 y=${maxY}(<=280)`);
    assert.ok(checked >= 3, `탈출 클릭이 충분히 발생하지 않음(인용구/구분선/캡션 최소 3회 기대): ${checked}`);

    // 7-21: 사진 삽입으로 열린 우측 도크가 스크린샷 전에 닫혔는지
    assert.ok(sidebarHiddenAfterClose, "우측 도크가 스크린샷 전에 닫히지 않음(7-21)");

    // 7-5: 인용구 다음 문단이 인용구 "밖"에 있는지
    const bqMatch = capturedHtml.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/);
    assert.ok(bqMatch, "blockquote(인용구)가 생성되지 않음");
    const quoteText = bqMatch![1];
    assert.equal(quoteText.trim(), "이것은 인용구 한 줄입니다", "인용구 텍스트가 예상과 다름");
    assert.ok(!quoteText.includes("인용구 다음에 오는 문단"), "다음 문단이 인용구 안으로 삼켜짐(7-5)");
    assert.ok(
      capturedParagraphTexts.some((t) => t.includes("인용구 다음에 오는 문단")),
      "다음 문단이 별도 문단으로 존재하지 않음"
    );

    // 7-18: 캡션이 사진 설명 칸에 들어갔고, 본문과 섞이지 않았는지
    assert.equal(capturedCaptionText.trim(), "사진 설명입니다", "캡션 텍스트가 사진 설명 칸에 정확히 들어가지 않음");
    assert.ok(
      !capturedParagraphTexts.some((t) => t.includes("사진 설명입니다") && t.length > "사진 설명입니다".length + 5),
      "캡션이 본문 문단과 합쳐짐(7-18)"
    );

    // 7-8: 마크다운 기호 유출 0
    for (const t of capturedParagraphTexts) {
      assert.ok(!t.includes("**"), `마크다운 ** 유출: "${t}"`);
      assert.ok(!t.includes("`"), `마크다운 backtick 유출: "${t}"`);
      assert.ok(!t.includes("~"), `마크다운 ~ (반각) 유출: "${t}"`); // 전각 물결표(～)는 허용
      assert.ok(!/^\s*#/.test(t), `마크다운 # 유출: "${t}"`);
      assert.ok(!/^\s*>/.test(t), `마크다운 > 유출: "${t}"`);
      assert.ok(!/^\s*[-*+]\s/.test(t), `마크다운 목록기호 유출: "${t}"`);
    }
    console.log("  OK 마크다운 기호 유출 없음(7-8)");

    // 7-25: VS16 이모지가 중복되지 않고 정확히 그대로 들어갔는지.
    // ⚠️ 네이티브 contenteditable에서 Enter가 항상 새 .se-text-paragraph 요소를
    // 만드는 건 아니다(브라우저 기본 동작) — 그건 6.5-a가 검증할 대상이 아니다
    // (하네스 결과를 서식/블록 분리의 증거로 쓰지 말라는 경고와 같은 종류).
    // 그래서 문단 "전체 일치"가 아니라 이어붙은 전체 텍스트에서 "부분 문자열"로
    // 원문이 그대로(중복 없이) 들어있는지를 본다.
    assert.ok(
      capturedParagraphTexts.some((t) => t.includes(vs16Text)),
      "VS16 이모지 구간이 원문 그대로 들어가지 않음(중복/손실 의심, 7-25)"
    );
    console.log("  OK VS16 이모지 중복 없음(7-25)");

    console.log("\n=== 시나리오 2: 실제 발행 — blog.naver.com URL로 라우트 가로채기 ===");
    const events2: HnEvent[] = [];
    const result2 = await publishToNaver(
      {
        jobId: 2,
        title: "실제 발행 테스트",
        sections: [{ type: "paragraph", text: "짧은 발행 테스트 본문입니다." }],
        imagePaths: {},
        visibility: "private",
        dryRun: false,
        blogId: "testblogid",
        headless: true,
        beforeNavigate: async (page: Page) => {
          await makeBeforeNavigate(events2)(page);
          await page.context().route("https://blog.naver.com/**", async (route) => {
            const u = new URL(route.request().url());
            const body = u.pathname === "/inner.html" ? buildInnerHtml() : buildOuterHtml("/inner.html");
            await route.fulfill({ body, contentType: "text/html" });
          });
        },
      },
      (msg, level) => console.log(`  [${level ?? "info"}] ${msg}`)
    );

    console.log("  result:", result2);
    assert.equal(result2.status, "published", "실제 발행 시나리오가 published로 끝나지 않음");
    assert.ok(result2.blogUrl && /blog\.naver\.com\/[^/]+\/\d{6,}/.test(result2.blogUrl), "blogUrl이 게시글 주소 패턴이 아님(7-11)");
    assert.equal(countEvents(events2, "publish-open-clicked"), 1, "발행 버튼이 눌리지 않음");
    const confirmDetail = events2.find((e) => e.name === "confirm-clicked");
    assert.ok(confirmDetail, "확인 버튼이 눌리지 않음");
    const checkedId = JSON.parse(confirmDetail!.detail).checkedId;
    // 7-19: 네이버 기본값은 전체공개(open_public checked)인데, private을 선택했으므로
    // 최종 확인 시점에는 open_private이 checked여야 한다.
    assert.equal(checkedId, "open_private", `공개 범위가 private으로 선택되지 않음(7-19) — 실제: ${checkedId}`);
    console.log("  OK 기본값(전체공개)이 아니라 비공개가 실제로 선택된 채 발행됨(7-19)");

    console.log("\n=== 시나리오 3: 본문을 못 찾는 하네스 — 실패 처리(7-26) ===");
    const events3: HnEvent[] = [];
    const result3 = await publishToNaver(
      {
        jobId: 3,
        title: "본문 못 찾음 테스트",
        sections: [{ type: "paragraph", text: "이 텍스트는 절대 입력되면 안 됩니다." }],
        imagePaths: {},
        visibility: "private",
        dryRun: true,
        entryUrl: `${base}/broken`,
        headless: true,
        beforeNavigate: makeBeforeNavigate(events3),
      },
      (msg, level) => console.log(`  [${level ?? "info"}] ${msg}`)
    );

    console.log("  result:", result3);
    assert.equal(result3.status, "failed", "본문을 못 찾았는데 실패 처리되지 않음(7-26)");
    assert.ok(result3.note.includes("본문"), `실패 사유에 '본문'이 언급되지 않음: ${result3.note}`);
    assert.ok(result3.screenshotPath && fs.existsSync(result3.screenshotPath), "실패 시 스크린샷이 저장되지 않음");
    console.log("  OK 본문을 못 찾자 조용히 제목 칸으로 새지 않고 즉시 실패 처리됨(7-26)");

    console.log("\n모든 시나리오 통과");
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
