// 뉴스·블로그 수집 (6-4).
//
// ⚠️ 셀렉터에 의존하지 않는다 — 네이버 검색 DOM은 자주 바뀐다. page.evaluate 안에서
// 모든 a[href]를 훑는 "일반 추출"로 구현하고, 노이즈를 정규식/규칙으로 걸러낸다.
// DOM 추출(collectRawLinks)은 브라우저 안에서만 의미가 있어 여기서 단위 테스트할 수
// 없지만, 필터링 규칙(filterAndDedup)은 순수 함수로 분리해 로컬 HTML 픽스처로
// 검증할 수 있게 했다(scripts/verify-trends.ts).
import type { Page } from "playwright";
import { getDb } from "@/lib/db";

export interface RawLink {
  href: string;
  text: string;
  containerText: string;
}

export interface CollectedItem {
  type: "news" | "blog";
  title: string;
  summary: string;
  url: string;
}

// ⚠️ help.naver.com/alias/news/... 는 href에 "/news/"가 포함돼 뉴스 조건에 부분일치한다.
// 실측: help.naver.com/alias/news/news_21.naver → "뉴스 기사와 댓글로 인한 문제..." 가
// AI 자료로 들어갔다(6-4). 네이버 고객센터를 명시적으로 제외한다.
const EXCLUDED_HREF_MARKERS = ["help.naver.com", "/alias/"];

const NEWS_HREF_MARKERS = ["news.naver.com", "/news/", "n.news"];
// 블로그 홈(blog.naver.com/아이디)이 아니라 실제 게시글만 잡는다.
const BLOG_POST_PATTERN = /blog\.naver\.com\/[^/]+\/\d{6,}/;

// 스크린리더용 보조 텍스트. "네이버뉴스새 창 열림" 처럼 링크 텍스트에 섞여 들어오는데,
// 이걸 먼저 지우지 않으면 11자라서 길이 필터를 그냥 통과해 노이즈 항목이 남는다.
const NEW_WINDOW_MARK = /새\s*창\s*열림/g;
const NOISE_TEXT = /광고|로그인|더보기|바로가기|언론사\s*선정|구독/;

function isExcludedHref(href: string): boolean {
  return EXCLUDED_HREF_MARKERS.some((m) => href.includes(m));
}

function cleanText(raw: string): string {
  return raw.replace(NEW_WINDOW_MARK, "").replace(/\s+/g, " ").trim();
}

function passesNoiseFilter(text: string): boolean {
  if (text.length < 8) return false;
  if (NOISE_TEXT.test(text)) return false;
  return true;
}

function matchesType(href: string, type: "news" | "blog"): boolean {
  if (isExcludedHref(href)) return false;
  return type === "news"
    ? NEWS_HREF_MARKERS.some((m) => href.includes(m))
    : BLOG_POST_PATTERN.test(href);
}

// raw 추출 결과를 다듬는다: 노이즈 제거 → 요약 추출 → URL당 하나(짧은 제목 우선) →
// 제목 앞 40자 중복 제거 → 상위 topN.
export function filterAndDedup(
  raw: RawLink[],
  type: "news" | "blog",
  topN: number
): CollectedItem[] {
  const candidates: CollectedItem[] = [];

  for (const r of raw) {
    if (!matchesType(r.href, type)) continue;
    const title = cleanText(r.text);
    if (!passesNoiseFilter(title)) continue;

    // 컨테이너 텍스트에서 링크 텍스트를 뺀 나머지가 요약이다.
    const rawLinkText = r.text.trim();
    const summarySource = rawLinkText && r.containerText.includes(rawLinkText)
      ? r.containerText.replace(rawLinkText, "")
      : r.containerText;
    const summary = cleanText(summarySource).slice(0, 260);

    candidates.push({ type, title, summary, url: r.href });
  }

  // 같은 기사가 [제목 링크] + [본문 스니펫 링크]로 두 번 잡힌다.
  // URL당 하나만 남기되 제목이 더 짧은 쪽을 고른다(스니펫은 길고 문장형이다).
  const byUrl = new Map<string, CollectedItem>();
  for (const c of candidates) {
    const prev = byUrl.get(c.url);
    if (!prev || c.title.length < prev.title.length) {
      byUrl.set(c.url, c);
    }
  }

  // 다른 URL이라도 같은 기사/글일 수 있으므로 제목 앞 40자를 키로 한 번 더 중복 제거.
  const seenKey = new Set<string>();
  const deduped: CollectedItem[] = [];
  for (const c of byUrl.values()) {
    const key = c.title.slice(0, 40);
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    deduped.push(c);
  }

  return deduped.slice(0, topN);
}

// 페이지 안의 모든 a[href]를 훑는다(셀렉터 없이). 브라우저 컨텍스트에서만 실행 가능.
export async function collectRawLinks(page: Page): Promise<RawLink[]> {
  return page.evaluate(() => {
    const out: { href: string; text: string; containerText: string }[] = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const el = a as HTMLAnchorElement;
      const container = el.closest("li, div");
      out.push({
        href: el.href,
        text: (el.textContent || "").trim(),
        containerText: (container?.textContent || "").trim(),
      });
    });
    return out;
  });
}

function searchUrl(where: "news" | "blog", keyword: string): string {
  const q = encodeURIComponent(keyword);
  const base = `https://search.naver.com/search.naver?where=${where}&query=${q}`;
  return where === "news" ? `${base}&sort=1` : base;
}

export async function collectTrends(
  page: Page,
  keyword: string,
  topN: number
): Promise<{ news: CollectedItem[]; blog: CollectedItem[] }> {
  await page.goto(searchUrl("news", keyword), { waitUntil: "domcontentloaded" });
  const newsRaw = await collectRawLinks(page);
  const news = filterAndDedup(newsRaw, "news", topN);

  await page.goto(searchUrl("blog", keyword), { waitUntil: "domcontentloaded" });
  const blogRaw = await collectRawLinks(page);
  const blog = filterAndDedup(blogRaw, "blog", topN);

  return { news, blog };
}

export function saveSources(jobId: number, items: CollectedItem[]): void {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO sources (job_id, type, title, summary, url, content) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const tx = db.transaction((rows: CollectedItem[]) => {
    for (const r of rows) stmt.run(jobId, r.type, r.title, r.summary, r.url, "");
  });
  tx(items);
}
