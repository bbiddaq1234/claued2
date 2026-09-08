// UI 상호작용 육안 확인용 임시 스크립트 — 설정 서랍, 유형 전환, 실제 잡 생성까지.
import { newContext } from "../lib/playwright";

async function main() {
  const { browser, context } = await newContext({ headless: true });
  const page = await context.newPage();
  await page.goto("http://localhost:4123/", { waitUntil: "networkidle" });

  // 설정 서랍 열기
  await page.getByLabel("설정 열기").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/drawer.png", fullPage: true });
  await page.getByLabel("설정 닫기").click();
  await page.waitForTimeout(300);

  // 체험단 유형으로 전환 + 사진 소스 local 선택
  await page.getByText("체험단", { exact: false }).first().click();
  await page.waitForTimeout(200);
  await page.locator(".field select").first().selectOption("local");
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/experience-local.png", fullPage: true });

  // 다시 auto로 전환 후 실제 잡 생성(none으로, 빠르게 실패하겠지만 UI 흐름 확인용)
  await page.getByText("자동 발굴", { exact: false }).first().click();
  await page.getByPlaceholder("예: 제주도 여행").fill("서울 성수동 카페");
  await page.getByRole("button", { name: /연습으로 만들기|글 만들고 발행하기/ }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/job-created.png", fullPage: true });

  await browser.close();
  console.log("saved /tmp/drawer.png /tmp/experience-local.png /tmp/job-created.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
