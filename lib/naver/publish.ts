// ★ 에디터 작성·서식·발행 — 이 프로젝트의 90% (6-9).
// 진입 직후 순서를 바꾸면 발행이 실패한다. 7장 함정 목록을 참고해서 읽을 것.
import path from "node:path";
import type { Browser, BrowserContext, FrameLocator, Locator, Page } from "playwright";
import { newContext } from "@/lib/playwright";
import { screenshotsDir } from "@/lib/paths";
import { EDITOR, FRAME_SELECTOR, type VisibilityKey } from "@/lib/naver/selectors";
import { neutralizeMarkdown, typeSafely } from "@/lib/naver/textUtils";
import type { Section, ParagraphSectionT } from "@/lib/types";
import { friendlyError } from "@/lib/friendlyError";

type LogLevel = "info" | "warn" | "error";
type LogFn = (message: string, level?: LogLevel) => void;

interface PendingUpload {
  path: string | null;
  done: boolean;
}

// 어디서든 locator를 받을 수 있는 공통 인터페이스(Page든 FrameLocator든).
interface Locatable {
  locator(selector: string): Locator;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(cond: () => boolean, timeoutMs: number, intervalMs = 300): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await wait(intervalMs);
  }
  return cond();
}

// 후보 배열 위에서부터 isVisible인 첫 번째를 반환한다. 각 항목은 "후보 배열"이라는
// 6-9의 규칙이 여기서 구현된다.
async function firstVisible(root: Locatable, candidates: readonly string[]): Promise<Locator | null> {
  for (const sel of candidates) {
    try {
      const loc = root.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) return loc;
    } catch {
      // 이 후보가 안 맞으면 다음 후보로 — 조용히 넘어간다.
    }
  }
  return null;
}

// ⚠️ 발행 버튼과 공개 범위 라디오가 iframe 안에 있는지 밖에 있는지는 환경마다
// 다르다(6-9). iframe 안 → 바깥 문서 순으로 반드시 두 곳 다 뒤진다.
async function clickAnywhere(
  page: Page,
  frame: FrameLocator,
  candidates: readonly string[]
): Promise<Locator | null> {
  const loc = (await firstVisible(frame, candidates)) ?? (await firstVisible(page, candidates));
  if (!loc) return null;
  await loc.click();
  return loc;
}

async function boundingBoxSafe(loc: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  // ⚠️ 7-27: boundingBox()는 요소가 없으면 Playwright 기본 30초를 기다린다.
  // 반드시 timeout을 짧게 준다.
  try {
    return await loc.boundingBox({ timeout: 800 });
  } catch {
    return null;
  }
}

// ── 오버레이 처리 ────────────────────────────────────────────────
async function handleRestorePopup(frame: FrameLocator, log: LogFn): Promise<"none" | "closed" | "stuck"> {
  const popup = await firstVisible(frame, EDITOR.restorePopup);
  if (!popup) return "none";

  // ⚠️ 7-1: 여기서 :has-text('취소')를 쓰면 '취소선' 버튼을 눌러 글 전체에
  // 취소선이 켜진다. selectors.ts의 restoreCancel은 클래스 기반 + 팝업 스코프
  // :text-is 정확일치만 쓰도록 이미 만들어져 있다 — 그대로 쓴다.
  const cancelBtn = await firstVisible(frame, EDITOR.restoreCancel);
  if (!cancelBtn) {
    log("복원 팝업의 취소 버튼을 찾지 못했습니다.", "warn");
    return "stuck";
  }
  await cancelBtn.click();
  await wait(500);

  // ⚠️ 7-3: 팝업 차단막(se-popup-dim)이 남아 있으면 이후 클릭이 조용히 무시된다.
  const dim = await firstVisible(frame, EDITOR.popupDim);
  if (dim) {
    log("팝업 차단막이 제거되지 않았습니다.", "warn");
    return "stuck";
  }
  const stillThere = await firstVisible(frame, EDITOR.restorePopup);
  return stillThere ? "stuck" : "closed";
}

async function closeOverlayGroup(
  frame: FrameLocator,
  panelCandidates: readonly string[],
  closeCandidates: readonly string[]
): Promise<void> {
  const panel = await firstVisible(frame, panelCandidates);
  if (!panel) return;
  const closeBtn = await firstVisible(frame, closeCandidates);
  if (closeBtn) {
    await closeBtn.click();
    await wait(300);
    return;
  }
  await frame.locator("body").first().press("Escape").catch(() => {});
}

// 도움말 패널 + 사이드바 도크를 둘 다 닫는다. ⚠️ 7-21: 도크 클래스 계열이 환경마다
// 달라서 두 계열을 전부 시도해야 한다. 사진을 넣으면 도크가 다시 열리므로
// 스크린샷 앞/뒤로 두 번 호출한다(6-9).
async function closeAllOverlays(frame: FrameLocator): Promise<void> {
  await closeOverlayGroup(frame, EDITOR.helpPanel, EDITOR.helpClose);
  await closeOverlayGroup(frame, EDITOR.sidebar, EDITOR.sidebarClose);
}

// ── 캐럿 탈출 (7-5, 7-6, 7-27) ───────────────────────────────────
// 인용구·구분선·캡션 컴포넌트 안에서는 어떤 키로도 탈출할 수 없다. 마지막
// 컴포넌트 아래 빈 영역을 마우스로 클릭하는 것만 통한다.
//
// ⚠️ 하단 글감 검색바(bottomToolbar)의 위치는 "한 번 재서 캐싱"하면 안 된다.
// 에디터 iframe은 뷰포트 높이를 그대로 따라가고(7-20) 실제로 스크롤하는 건
// iframe을 담은 바깥 문서이므로, 탈출 클릭 도중 스크롤이 한 번이라도 일어나면
// position:fixed인 검색바의 "페이지 기준" y좌표 자체가 달라진다. 캐싱된 옛
// 값으로 클램프하면 실제로는 안전하지 않은 y를 "안전하다"고 오판할 수 있다
// (하네스에서 정확히 이 형태로 재현됨 — 8-1: 추측 대신 실측으로 확인).
// 7-27이 말하는 "반복해 재지 말 것"은 같은 호출 안에서 같은 값을 두 번 재는
// 것을 가리킨다 — timeout:800으로 짧게 재는 한, 매 탈출 호출마다 새로 재는
// 것 자체는 비싸지 않다.
async function measureMaxEscapeY(frame: FrameLocator, viewportHeight: number): Promise<number> {
  const barLoc = await firstVisible(frame, EDITOR.bottomToolbar);
  const barBox = barLoc ? await boundingBoxSafe(barLoc) : null;
  const bottomBarTop = barBox ? barBox.y : null;
  return Math.min(bottomBarTop != null ? bottomBarTop - 20 : viewportHeight - 150, viewportHeight - 20);
}

async function escapeCursor(page: Page, frame: FrameLocator): Promise<void> {
  const components = frame.locator(EDITOR.contentComponents[0]);
  const count = await components.count().catch(() => 0);
  if (count === 0) {
    await page.keyboard.press("End");
    return;
  }
  const box = await boundingBoxSafe(components.last());
  if (!box) {
    await page.keyboard.press("End");
    return;
  }

  const viewport = page.viewportSize() ?? { width: 1366, height: 900 };
  let y = box.y + box.height + 30;
  let maxY = await measureMaxEscapeY(frame, viewport.height);

  if (y > maxY) {
    // 아래 여백이 없으면 스크롤해서 공간을 만든 뒤, 컴포넌트와 검색바 위치를
    // 스크롤 이후 기준으로 "둘 다" 한 번만 다시 잰다.
    await page.mouse.wheel(0, 250).catch(() => {});
    await wait(200);
    const box2 = await boundingBoxSafe(components.last());
    if (box2) y = box2.y + box2.height + 30;
    maxY = await measureMaxEscapeY(frame, viewport.height);
  }
  y = Math.max(140, Math.min(y, maxY));
  const x = box.x + Math.min(40, box.width / 2);
  await page.mouse.click(x, y);
}

// ── 서식 적용 ────────────────────────────────────────────────────
async function applyTextFormat(frame: FrameLocator, optionCandidates: readonly string[]): Promise<void> {
  const opener = await firstVisible(frame, EDITOR.textFormatOpen);
  if (opener) {
    await opener.click();
    await wait(350); // 드롭다운 애니메이션
  }
  const opt = await firstVisible(frame, optionCandidates);
  if (opt) {
    await opt.click();
    await wait(350);
  }
}

async function setHighlight(frame: FrameLocator, on: boolean): Promise<void> {
  const boldBtn = await firstVisible(frame, EDITOR.bold);
  if (boldBtn) {
    await boldBtn.click();
    await wait(300);
  }
  const bgOpen = await firstVisible(frame, EDITOR.bgColorOpen);
  if (bgOpen) {
    await bgOpen.click();
    await wait(300);
    const target = on ? EDITOR.bgColorYellow : EDITOR.bgColorNone;
    const opt = await firstVisible(frame, target);
    if (opt) {
      await opt.click();
      await wait(300);
    }
  }
}

// ── 섹션 타입별 입력 (6-9 표) ─────────────────────────────────────
async function typeHeadingSection(page: Page, frame: FrameLocator, text: string): Promise<void> {
  await applyTextFormat(frame, EDITOR.optHeading);
  await typeSafely(page, neutralizeMarkdown(text));
  await page.keyboard.press("Enter");
  await applyTextFormat(frame, EDITOR.optBody); // 본문으로 복귀
}

async function typeParagraphSection(page: Page, frame: FrameLocator, section: ParagraphSectionT, log: LogFn): Promise<void> {
  const raw = section.text;
  // ⚠️ 7-24: 타이핑 직전에도 한 번 더 indexOf로 확인한다(이중 방어).
  // 못 찾으면 형광펜을 생략한다 — 초안 전체를 버리지 않는다.
  const idx = section.highlight ? raw.indexOf(section.highlight) : -1;

  if (!section.highlight || idx === -1) {
    if (section.highlight && idx === -1) {
      log("highlight가 본문에 없어 형광펜 없이 입력합니다.", "warn");
    }
    await typeSafely(page, neutralizeMarkdown(raw));
  } else {
    const before = raw.slice(0, idx);
    const mid = raw.slice(idx, idx + section.highlight.length);
    const after = raw.slice(idx + section.highlight.length);
    if (before) await typeSafely(page, neutralizeMarkdown(before));
    // ⚠️ 인라인 서식은 "클릭 이후 새로 입력되는 글자"에 적용된다(선택 후 적용이 아님).
    await setHighlight(frame, true);
    await typeSafely(page, neutralizeMarkdown(mid));
    await setHighlight(frame, false);
    if (after) await typeSafely(page, neutralizeMarkdown(after));
  }
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
}

async function typeQuoteSection(page: Page, frame: FrameLocator, text: string): Promise<void> {
  await typeSafely(page, neutralizeMarkdown(text));
  await page.keyboard.press("Shift+Home");
  await applyTextFormat(frame, EDITOR.optQuote);
  // ⚠️ 7-5: 인용구 컴포넌트 안에서는 어떤 키로도 탈출되지 않는다. 마우스 클릭만 통한다.
  await escapeCursor(page, frame);
}

async function insertDividerSection(page: Page, frame: FrameLocator): Promise<void> {
  const btn = await firstVisible(frame, EDITOR.dividerInsert);
  if (btn) {
    await btn.click();
    await wait(300);
  }
  await escapeCursor(page, frame);
}

async function insertImageSection(
  page: Page,
  frame: FrameLocator,
  opts: { localPath: string; caption?: string },
  pendingUpload: PendingUpload,
  log: LogFn
): Promise<void> {
  pendingUpload.path = opts.localPath;
  pendingUpload.done = false;

  const btn = await firstVisible(frame, EDITOR.imageButton);
  if (!btn) {
    log("이미지 버튼을 찾지 못해 이 자리를 건너뜁니다.", "warn");
    return;
  }
  await btn.click();

  const uploaded = await pollUntil(() => pendingUpload.done, 20_000);
  if (!uploaded) {
    log("이미지 업로드가 20초 안에 끝나지 않아 이 자리를 건너뜁니다.", "warn");
    return;
  }
  await wait(2600);

  const components = frame.locator(EDITOR.imageComponent[0]);
  const count = await components.count().catch(() => 0);
  if (count === 0) {
    log("이미지 컴포넌트를 찾지 못했습니다.", "warn");
    return;
  }
  const last = components.last();
  // ⚠️ 7-18: 캡션 칸은 업로드 직후 0×0이라 곧바로 클릭할 수 없다. 이미지
  // 컴포넌트를 먼저 클릭해야 펼쳐진다. 크기 숫자가 아니라 se-is-on 클래스로 판정한다.
  await last.click({ timeout: 1500 }).catch(() => {});
  await wait(300);

  if (!opts.caption) return;

  const captionLoc = last.locator(EDITOR.caption[0]).first();
  let expanded = false;
  for (let i = 0; i < 5; i++) {
    const cls = await captionLoc.getAttribute("class").catch(() => null);
    if (cls?.includes("se-is-on")) {
      expanded = true;
      break;
    }
    await last.click({ timeout: 1000 }).catch(() => {});
    await wait(300);
  }

  if (!expanded) {
    log("사진 설명 칸이 펼쳐지지 않아 캡션 없이 넘어갑니다.", "warn");
    return;
  }

  await captionLoc.click({ timeout: 1000 }).catch(() => {});
  await typeSafely(page, neutralizeMarkdown(opts.caption));
  // 캡션도 컴포넌트 안이다 — 7-5의 마우스 탈출을 여기서도 해야 다음 문단이 안 붙는다.
  await escapeCursor(page, frame);
}

async function typeSection(
  page: Page,
  frame: FrameLocator,
  section: Section,
  index: number,
  imagePaths: Record<number, string>,
  headingAsQuote: boolean,
  pendingUpload: PendingUpload,
  log: LogFn
): Promise<void> {
  switch (section.type) {
    case "heading":
      // 유형별 모드(체험단·브랜딩)는 소제목도 인용구로 처리한다(6-9).
      if (headingAsQuote) await typeQuoteSection(page, frame, section.text);
      else await typeHeadingSection(page, frame, section.text);
      return;
    case "paragraph":
      await typeParagraphSection(page, frame, section, log);
      return;
    case "quote":
      await typeQuoteSection(page, frame, section.text);
      return;
    case "divider":
      await insertDividerSection(page, frame);
      return;
    case "image": {
      const localPath = imagePaths[index];
      if (!localPath) {
        log(`${index}번 자리에 쓸 사진을 구하지 못해 건너뜁니다.`, "warn");
        return;
      }
      await insertImageSection(page, frame, { localPath, caption: section.caption }, pendingUpload, log);
      return;
    }
  }
}

// ── 스크린샷 (7-20) ──────────────────────────────────────────────
async function takeFullEditorScreenshot(page: Page, frame: FrameLocator, jobId: number): Promise<string> {
  const original = page.viewportSize() ?? { width: 1366, height: 900 };
  const content = frame.locator(".se-content").first();

  let scrollHeight = 0;
  let topY = 0;
  try {
    scrollHeight = await content.evaluate((el) => el.scrollHeight);
    const box = await boundingBoxSafe(content);
    topY = box?.y ?? 0;
  } catch {
    scrollHeight = 0;
  }

  // ⚠️ boundingBox().height로 계산하지 않는다 — 잘린 높이만 나온다(761 vs 3637, 7-20).
  if (scrollHeight > 0) {
    const newHeight = Math.min(9000, Math.round(topY + scrollHeight + 160));
    if (newHeight > original.height) {
      await page.setViewportSize({ width: original.width, height: newHeight });
      await wait(1200);
    }
  }

  const dest = path.join(screenshotsDir(jobId), `preview-${Date.now()}.png`);
  await page.screenshot({ path: dest, fullPage: true });

  await page.setViewportSize(original);
  return dest;
}

async function saveFailureScreenshot(page: Page, jobId: number, tag: string): Promise<string> {
  const dest = path.join(screenshotsDir(jobId), `fail-${tag}-${Date.now()}.png`);
  await page.screenshot({ path: dest, fullPage: true }).catch(() => {});
  return dest;
}

// ── 공개 범위 (7-19) ─────────────────────────────────────────────
async function isRadioChecked(page: Page, frame: FrameLocator, inputSel: string): Promise<boolean> {
  const inFrame = frame.locator(inputSel).first();
  if ((await inFrame.count().catch(() => 0)) > 0) {
    return inFrame.isChecked().catch(() => false);
  }
  const inPage = page.locator(inputSel).first();
  if ((await inPage.count().catch(() => 0)) > 0) {
    return inPage.isChecked().catch(() => false);
  }
  return false;
}

async function selectVisibility(page: Page, frame: FrameLocator, key: VisibilityKey, log: LogFn): Promise<boolean> {
  const { label, input } = EDITOR.visibility[key];
  const labelLoc = await clickAnywhere(page, frame, [label]);
  if (!labelLoc) {
    log(`공개 범위(${key}) 라디오를 찾지 못했습니다.`, "warn");
    return false;
  }
  await wait(300);
  const checked = await isRadioChecked(page, frame, input);
  if (!checked) {
    log(`공개 범위(${key}) 선택이 input.checked로 확인되지 않았습니다.`, "warn");
    return false;
  }
  return true;
}

// ── 실제 발행 검증 (7-11) ────────────────────────────────────────
const PUBLISHED_URL_RE = /blog\.naver\.com\/[^/]+\/\d{6,}/;

async function pollPublishedUrl(page: Page, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (PUBLISHED_URL_RE.test(page.url())) return page.url();
    await wait(500);
  }
  return PUBLISHED_URL_RE.test(page.url()) ? page.url() : null;
}

// ── 발행 가드 (연습 모드가 아닐 때만 검사) ───────────────────────
export interface PublishGuardSettings {
  killSwitch: boolean;
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
}

export type PublishGuardResult = { blocked: false } | { blocked: true; reason: string };

export function checkPublishGuard(
  settings: PublishGuardSettings,
  publishedTodayCount: number,
  lastPublishedAt: Date | null
): PublishGuardResult {
  if (settings.killSwitch) {
    return { blocked: true, reason: "전체 중단(kill switch)이 켜져 있어 발행하지 않았습니다." };
  }
  if (publishedTodayCount >= settings.dailyPublishLimit) {
    return { blocked: true, reason: `오늘 발행 한도(${settings.dailyPublishLimit}편)에 도달해 발행하지 않았습니다.` };
  }
  if (lastPublishedAt) {
    const minutesSince = (Date.now() - lastPublishedAt.getTime()) / 60_000;
    if (minutesSince < settings.minPublishIntervalMin) {
      return {
        blocked: true,
        reason: `최소 발행 간격(${settings.minPublishIntervalMin}분)이 지나지 않아 발행하지 않았습니다.`,
      };
    }
  }
  return { blocked: false };
}

// ── 메인 오케스트레이션 ──────────────────────────────────────────
export interface PublishInput {
  jobId: number;
  title: string;
  sections: Section[];
  imagePaths: Record<number, string>; // section index → 로컬 이미지 경로 (image 섹션만)
  visibility: VisibilityKey;
  dryRun: boolean;
  headingAsQuote?: boolean;
  blogId?: string; // 실제 네이버 발행용
  entryUrl?: string; // ⚠️ 테스트 전용: 로컬 하네스에 붙는다(9장 6.5-a)
  useNaverSession?: boolean;
  headless?: boolean;

  // ⚠️ 아래 세 개는 테스트 전용 관찰 훅이다. entryUrl과 같은 취지 — 실제 네이버
  // 발행(pipeline.ts)에서는 항상 undefined이고 동작에 아무 영향을 주지 않는다.
  // 하네스 테스트가 브라우저를 닫기 전에 page.exposeFunction/evaluate로 상태를
  // 들여다볼 수 있게 하는 관찰 지점일 뿐, 발행 로직 자체를 바꾸지 않는다.
  beforeNavigate?: (page: Page) => Promise<void>;
  afterSectionsTyped?: (page: Page, frame: FrameLocator) => Promise<void>;
  afterOverlaysClosed?: (page: Page, frame: FrameLocator) => Promise<void>;
}

export interface PublishOutput {
  status: "published" | "dry_run" | "failed";
  blogUrl?: string;
  screenshotPath?: string;
  note: string;
}

export async function publishToNaver(input: PublishInput, log: LogFn = () => {}): Promise<PublishOutput> {
  const pendingUpload: PendingUpload = { path: null, done: false };
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    const created = await newContext({
      headless: input.headless ?? true,
      useNaverSession: input.useNaverSession ?? !input.entryUrl,
    });
    browser = created.browser;
    context = created.context;

    const page = await context.newPage();

    // 1. 영구 파일선택 핸들러 — 페이지를 열기 "전에" 등록한다(7-7, 플랫폼 무관).
    page.on("filechooser", async (chooser) => {
      try {
        if (pendingUpload.path) await chooser.setFiles(pendingUpload.path);
      } finally {
        pendingUpload.done = true;
      }
    });

    await input.beforeNavigate?.(page);

    const entry = input.entryUrl ?? `https://blog.naver.com/${input.blogId}?Redirect=Write&categoryNo=0`;
    await page.goto(entry, { waitUntil: "domcontentloaded" });
    await wait(2500); // 2. 에디터 진입, 2.5초 대기

    const frame = page.frameLocator(FRAME_SELECTOR);

    // 3. '작성 중인 글이 있습니다' 복원 팝업 처리
    const popupState = await handleRestorePopup(frame, log);
    if (popupState === "stuck") {
      const shot = await saveFailureScreenshot(page, input.jobId, "restore-popup-stuck");
      return { status: "failed", screenshotPath: shot, note: "이전 글 복원 팝업을 닫지 못해 중단했습니다." };
    }

    // 4. 도움말/온보딩 패널 닫기
    await closeAllOverlays(frame);

    // 5. 제목 입력 → 본문 클릭 → 섹션 순차 입력
    const titleLoc = await firstVisible(frame, EDITOR.title);
    if (!titleLoc) {
      const shot = await saveFailureScreenshot(page, input.jobId, "title-not-found");
      return { status: "failed", screenshotPath: shot, note: "제목 입력 칸을 찾지 못해 중단했습니다." };
    }
    await titleLoc.click();
    await typeSafely(page, neutralizeMarkdown(input.title));

    // ⚠️ 7-26: 본문을 못 찾으면 Enter로 한 번 더 시도하고, 그래도 못 찾으면 즉시
    // 실패 처리한다. 조용히 진행하면 글 전체가 제목 칸에 들어간다.
    let bodyLoc = await firstVisible(frame, EDITOR.body);
    if (!bodyLoc) {
      await page.keyboard.press("Enter");
      await wait(500);
      bodyLoc = await firstVisible(frame, EDITOR.body);
    }
    if (!bodyLoc) {
      const shot = await saveFailureScreenshot(page, input.jobId, "body-not-found");
      return {
        status: "failed",
        screenshotPath: shot,
        note: "본문 입력 영역을 찾지 못해 중단했습니다(그대로 진행하면 글 전체가 제목 칸에 들어갑니다).",
      };
    }
    await bodyLoc.click();

    const headingAsQuote = input.headingAsQuote ?? false;
    for (let i = 0; i < input.sections.length; i++) {
      await typeSection(page, frame, input.sections[i], i, input.imagePaths, headingAsQuote, pendingUpload, log);
    }

    await input.afterSectionsTyped?.(page, frame);

    // 6. 도움말 패널 + 오버레이 도크 닫기 — ⚠️ 스크린샷 "앞"에 한 번(7-21).
    await closeAllOverlays(frame);
    await input.afterOverlaysClosed?.(page, frame);

    // 7. 발행 직전 전체 스크린샷 저장
    const preShot = await takeFullEditorScreenshot(page, frame, input.jobId);

    // 8. 연습 모드면 여기서 종료
    if (input.dryRun) {
      return { status: "dry_run", screenshotPath: preShot, note: "연습 모드 — 발행하지 않고 완성 화면만 저장했습니다." };
    }

    // 9. 다시 한 번 닫기 — ⚠️ 스크린샷 "뒤"(사진 삽입으로 도크가 재차 열렸을 수 있음).
    await closeAllOverlays(frame);

    // 10. 발행 버튼 클릭
    const publishBtn = await clickAnywhere(page, frame, EDITOR.publishOpen);
    if (!publishBtn) {
      const shot = await saveFailureScreenshot(page, input.jobId, "publish-button-not-found");
      return { status: "failed", screenshotPath: shot, note: "발행 버튼을 찾지 못해 중단했습니다." };
    }
    await wait(500);

    // 11. 공개 범위 선택 + input.checked 확인 — ⚠️ 확인 안 되면 발행하지 않는다(7-19).
    const visOk = await selectVisibility(page, frame, input.visibility, log);
    if (!visOk) {
      const shot = await saveFailureScreenshot(page, input.jobId, "visibility-not-confirmed");
      return { status: "failed", screenshotPath: shot, note: "공개 범위를 확인할 수 없어 발행을 중단했습니다." };
    }

    // 12. 최종 확인 버튼
    const confirmBtn = await clickAnywhere(page, frame, EDITOR.publishConfirm);
    if (!confirmBtn) {
      const shot = await saveFailureScreenshot(page, input.jobId, "confirm-button-not-found");
      return {
        status: "failed",
        screenshotPath: shot,
        note: "최종 확인 버튼을 찾지 못해 중단했습니다. 글은 임시저장 상태로 남아 있을 수 있습니다.",
      };
    }

    // 13. 실제 발행 검증 — 발행 버튼을 눌렀다는 사실이 발행됐다는 뜻은 아니다(7-11).
    const publishedUrl = await pollPublishedUrl(page, 20_000);
    if (!publishedUrl) {
      const shot = await saveFailureScreenshot(page, input.jobId, "publish-not-confirmed");
      return {
        status: "failed",
        screenshotPath: shot,
        note: "발행 버튼을 눌렀지만 게시글 주소로 이동하지 않았습니다. 글은 임시저장 상태로 남아 있을 수 있습니다.",
      };
    }

    return { status: "published", blogUrl: publishedUrl, screenshotPath: preShot, note: "발행되었습니다." };
  } catch (err) {
    // ⚠️ 여기서 예외를 그대로 던지면 pipeline.ts까지 Playwright 원문 에러(네트워크
    // 실패 등)가 그대로 전파돼 사용자에게 스택트레이스가 보인다. 실패도 정상적인
    // PublishOutput으로 돌려준다 — "실패를 성공으로 보고하지 마라"는 실패를 숨기지
    // 말라는 뜻이지, 원문 에러를 그대로 노출하라는 뜻이 아니다(8-2, 8-6).
    const { summary, detail } = friendlyError(err);
    console.error(`[job ${input.jobId}] 발행 중 예외(${detail}):`, err);
    return { status: "failed", note: summary };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
