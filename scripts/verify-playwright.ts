// lib/playwright.ts 검증용 (10-A, 계정 불필요). 네이버 접속 없이 브라우저 실행만 확인한다.
// 실행: npx tsx scripts/verify-playwright.ts
import { newContext } from "../lib/playwright";

async function main() {
  console.log("headless 컨텍스트 생성 중...");
  const { browser, context } = await newContext({ headless: true });
  try {
    const page = await context.newPage();
    await page.goto("about:blank");
    const viewport = page.viewportSize();
    const ua = await page.evaluate(() => navigator.userAgent);
    const locale = await page.evaluate(() => navigator.language);
    console.log({ viewport, ua, locale });
    if (viewport?.width !== 1366 || viewport?.height !== 900) {
      throw new Error("뷰포트가 1366x900이 아닙니다.");
    }
    if (!/Windows NT 10.0.*Chrome/.test(ua)) {
      throw new Error("데스크톱 Chrome UA가 아닙니다.");
    }
    console.log("OK: 브라우저 실행 + 컨텍스트 옵션 확인됨");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
