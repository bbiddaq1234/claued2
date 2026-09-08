// lib/scrape/trends.ts 검증용 (10-A, 계정 불필요). 실제 네이버 대신 로컬 HTML
// 픽스처를 헤드리스 브라우저에 그대로 로드해, DOM 추출(collectRawLinks)과
// 필터링(filterAndDedup)을 실제 코드 경로 그대로 검증한다.
// 실행: npx tsx scripts/verify-trends.ts
import assert from "node:assert/strict";
import { newContext } from "../lib/playwright";
import { collectRawLinks, filterAndDedup } from "../lib/scrape/trends";

const FIXTURE_HTML = `<!doctype html><html><body>
<ul id="news-list">
  <li>
    <a href="https://news.naver.com/main/read.naver?oid=001&aid=000123">제주 감귤 풍년, 역대 최고 수확량 기록</a>
    <p>제주 지역 감귤 농가들이 올해 역대급 수확량을 기록했다고 밝혔다.</p>
  </li>
  <li>
    <a href="https://news.naver.com/main/read.naver?oid=001&aid=000123">제주 지역 감귤 농가들이 올해 역대급 수확량을 기록했다고 다시 한번 강조하며 전했다는 소식입니다</a>
  </li>
  <li>
    <a href="https://help.naver.com/alias/news/news_21.naver">뉴스 기사와 댓글로 인한 문제 발생시 24시간 센터로 접수해주세요</a>
  </li>
  <li>
    <a href="https://news.naver.com/main/read.naver?oid=002&aid=000456">네이버뉴스새 창 열림</a>
  </li>
  <li>
    <a href="https://news.naver.com/main/list.naver?mode=LSD">구독하기 알림 설정</a>
  </li>
  <li>
    <a href="https://n.news.naver.com/mnews/article/001/0001234567">전국 폭염특보 확대, 온열질환 주의보 발령</a>
    <p>기상청은 다음 주까지 폭염특보가 이어질 것으로 내다봤다.</p>
  </li>
  <li>
    <a href="https://news.naver.com/main/read.naver?oid=003&aid=000789">서울 지하철 요금 다음 달부터 인상</a>
  </li>
  <li>
    <a href="https://news.naver.com/main/read.naver?oid=004&aid=000999">가을 단풍 절정 시기 이번 주말로 예상</a>
  </li>
</ul>
<div id="blog-list">
  <div>
    <a href="https://blog.naver.com/myblogid/223456789012">집에서 만드는 홈카페 레시피 총정리</a>
    <span>원두 고르는 법부터 라떼아트까지 한 번에 정리했어요.</span>
  </div>
  <div>
    <a href="https://blog.naver.com/myblogid">내 블로그 홈으로 가기</a>
  </div>
  <div>
    <a href="https://blog.naver.com/otheruser/223456789013">제주도 감성 카페 추천 베스트5</a>
  </div>
  <div>
    <a href="https://blog.naver.com/spammer/223456789099">광고 협찬 문의 환영합니다</a>
  </div>
</div>
</body></html>`;

async function main() {
  const { browser, context } = await newContext({ headless: true });
  try {
    const page = await context.newPage();
    await page.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });

    const raw = await collectRawLinks(page);
    console.log(`raw anchor 개수: ${raw.length}`);

    const news = filterAndDedup(raw, "news", 3);
    const blog = filterAndDedup(raw, "blog", 10);

    console.log("news:", news);
    console.log("blog:", blog);

    // help.naver.com/alias 오탐 제외 (6-4 경고)
    assert.ok(
      !news.some((n) => n.url.includes("help.naver.com")),
      "help.naver.com/alias 링크가 걸러지지 않음"
    );
    // "새 창 열림" 제거 후 길이 필터로 탈락
    assert.ok(
      !news.some((n) => n.title.includes("네이버뉴스")),
      "새 창 열림 보조 텍스트가 걸러지지 않음"
    );
    // 노이즈 텍스트(구독) 제외
    assert.ok(
      !news.some((n) => n.title.includes("구독")),
      "노이즈 텍스트(구독)가 걸러지지 않음"
    );
    // 같은 기사 URL 중복 제거 + 더 짧은 제목 선택
    const dupUrlCount = news.filter((n) => n.url.includes("aid=000123")).length;
    assert.equal(dupUrlCount, 1, "같은 기사 URL이 중복 제거되지 않음");
    const dup = news.find((n) => n.url.includes("aid=000123"));
    assert.equal(dup?.title, "제주 감귤 풍년, 역대 최고 수확량 기록", "더 짧은 제목이 선택되지 않음");
    // topN(3) 제한
    assert.equal(news.length, 3, `topN=3인데 ${news.length}개 반환됨`);

    // 블로그 홈(글 아님) 제외
    assert.ok(
      !blog.some((b) => b.url === "https://blog.naver.com/myblogid"),
      "블로그 홈 링크가 게시글로 잘못 포함됨"
    );
    // 광고 노이즈 제외
    assert.ok(!blog.some((b) => b.title.includes("광고")), "광고 노이즈가 걸러지지 않음");
    // 정상 게시글 2개는 남아야 함
    assert.equal(blog.length, 2, `블로그 게시글이 2개여야 하는데 ${blog.length}개`);

    console.log("\nOK: 모든 필터링 규칙이 로컬 픽스처에서 확인됨");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
