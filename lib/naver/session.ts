// 네이버 로그인 창 + 세션 저장/검증 (6-3).
//
// ⚠️ 로그인 자체는 자동화하지 않는다(2-4) — 보안문자·2차인증 때문이다.
// 창을 띄워 사용자가 직접 로그인하게 하고, NID_SES 쿠키가 생기면 storageState를 저장한다.
import fs from "node:fs";
import { newContext } from "@/lib/playwright";
import { sessionFile } from "@/lib/paths";

const LOGIN_URL = "https://nid.naver.com/nidlogin.login";
const POLL_MS = 1000;
const MAX_WAIT_MS = 5 * 60 * 1000; // 최대 5분 대기

// 동시 로그인 창 방지 플래그.
let loginInFlight = false;
export function isLoginInFlight(): boolean {
  return loginInFlight;
}

export type LoginResult = { ok: true } | { ok: false; reason: string };

export async function loginInteractive(): Promise<LoginResult> {
  if (loginInFlight) {
    return { ok: false, reason: "이미 로그인 창이 열려 있습니다." };
  }
  loginInFlight = true;
  try {
    // 로그인 창은 화면에 보여야 하므로 headless:false 로 띄운다.
    const { browser, context } = await newContext({ headless: false, useNaverSession: false });
    try {
      const page = await context.newPage();
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

      const deadline = Date.now() + MAX_WAIT_MS;
      while (Date.now() < deadline) {
        if (page.isClosed()) {
          return { ok: false, reason: "사용자가 로그인 창을 닫았습니다." };
        }
        const cookies = await context.cookies();
        const hasSession = cookies.some((c) => c.name === "NID_SES");
        if (hasSession) {
          // 쿠키를 안정화하기 위해 naver.com으로 한 번 이동한 뒤 저장한다.
          try {
            await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
          } catch {
            // 이동 실패해도 쿠키 자체는 이미 확보됐으므로 계속 진행한다.
          }
          await context.storageState({ path: sessionFile() });
          invalidateSessionCache();
          return { ok: true };
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      return { ok: false, reason: "5분 안에 로그인이 완료되지 않았습니다." };
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    loginInFlight = false;
  }
}

// ── 세션 검증 (7-9, 7-10 주의) ─────────────────────────────────────
export type VerifyResult =
  | { valid: true; blogId: string }
  | { valid: false; reason: string };

interface CacheEntry {
  result: VerifyResult;
  expiresAt: number;
}

// 검증은 브라우저를 띄우므로 비용이 크다 — TTL 5분 캐시를 둔다.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

export function invalidateSessionCache(): void {
  cache = null;
}

function extractBlogId(url: string): string | null {
  const m = url.match(/blog\.naver\.com\/([^/?#]+)/);
  return m ? m[1] : null;
}

function isLoginRedirect(url: string): boolean {
  return url.includes("nid.naver.com");
}

async function verifySessionUncached(): Promise<VerifyResult> {
  if (!fs.existsSync(sessionFile())) {
    return { valid: false, reason: "저장된 로그인 정보가 없습니다." };
  }

  const { browser, context } = await newContext({ headless: true, useNaverSession: true });
  try {
    const page = await context.newPage();

    // 1단계: 읽기 권한 — naver.com 메인의 로그인 링크로 판정하면 안 된다(7-9).
    // 로그인 상태에서도 nidlogin 링크가 페이지에 남아 있어 항상 "만료"로 오판된다.
    await page.goto("https://blog.naver.com/MyBlog.naver", { waitUntil: "domcontentloaded" });
    if (isLoginRedirect(page.url())) {
      return { valid: false, reason: "로그인이 만료되었습니다." };
    }
    const blogId = extractBlogId(page.url());
    if (!blogId) {
      return { valid: false, reason: "블로그 주소를 확인할 수 없습니다." };
    }

    // 2단계: 쓰기 권한 — 읽기는 되는데 글쓰기만 만료된 상태가 실제로 존재한다(7-10).
    // "로그인 상태 유지"를 체크하지 않으면 세션 쿠키가 브라우저 종료와 함께 사라지고,
    // 일부 읽기 경로만 살아남는다.
    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&categoryNo=0`, {
      waitUntil: "domcontentloaded",
    });
    if (isLoginRedirect(page.url())) {
      return { valid: false, reason: "글쓰기 권한이 만료되었습니다. 로그인할 때 '로그인 상태 유지'를 켜주세요." };
    }

    return { valid: true, blogId };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function verifySession(opts: { refresh?: boolean } = {}): Promise<VerifyResult> {
  if (!opts.refresh && cache && cache.expiresAt > Date.now()) {
    return cache.result;
  }
  const result = await verifySessionUncached();
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

export function logout(): void {
  try {
    if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
  } finally {
    invalidateSessionCache();
  }
}
