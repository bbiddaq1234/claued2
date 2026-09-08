// 대시보드 화면 육안 확인용 임시 스크립트(검증 스위트 아님).
import { newContext } from "../lib/playwright";

async function main() {
  const { browser, context } = await newContext({ headless: true });
  const page = await context.newPage();
  await page.goto("http://localhost:4123/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/dashboard.png", fullPage: true });
  await browser.close();
  console.log("saved /tmp/dashboard.png");
}

main();
