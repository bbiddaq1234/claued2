// 브라우저 실행 + chromium 자동설치 (6-2).
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { sessionFile } from "@/lib/paths";

const execFileAsync = promisify(execFile);

// 데스크톱 Chrome UA — 네이버가 모바일 UA에 다른(더 단순한) 화면을 준다.
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// chromium.launch()가 "Executable doesn't exist"류로 실패하는 패턴 (2-3).
const CHROMIUM_MISSING = /Executable doesn'?t exist|please run|install/i;

// 설치 Promise를 모듈 레벨에 캐싱한다 — 여러 요청이 동시에 launch에 실패해도
// `npx playwright install`이 중복 실행되지 않게 한다.
let installPromise: Promise<void> | null = null;

async function ensureChromiumInstalled(): Promise<void> {
  if (!installPromise) {
    installPromise = execFileAsync("npx", ["playwright", "install", "chromium"], {
      maxBuffer: 1024 * 1024 * 20,
      timeout: 5 * 60 * 1000,
    })
      .then(() => undefined)
      .catch((err) => {
        installPromise = null; // 실패하면 다음 시도에서 다시 설치를 시도하도록 캐시를 비운다.
        throw err;
      });
  }
  await installPromise;
}

export interface NewContextOpts {
  headless?: boolean;
  useNaverSession?: boolean;
}

export async function newContext(
  opts: NewContextOpts = {}
): Promise<{ browser: Browser; context: BrowserContext }> {
  const headless = opts.headless ?? true;

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (!CHROMIUM_MISSING.test(msg)) throw err;
    await ensureChromiumInstalled();
    browser = await chromium.launch({ headless }); // 1회 재시도
  }

  const contextOpts: Parameters<Browser["newContext"]>[0] = {
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    userAgent: DESKTOP_UA,
  };

  if (opts.useNaverSession && fs.existsSync(sessionFile())) {
    contextOpts.storageState = sessionFile();
  }

  const context = await browser.newContext(contextOpts);
  return { browser, context };
}
