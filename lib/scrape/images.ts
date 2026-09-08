// 이미지 검색·다운로드·비전 채택 — 크롤링 사진 (6-6).
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { getDb } from "@/lib/db";
import { judgeCrawlImage, categorizeCrawlRejection } from "@/lib/ai/vision";

export type ImageSite = "naver" | "google" | "ai" | "local";

export interface ImageCandidate {
  url: string;
  site: "naver" | "google";
}

function extFromUrl(u: string): string {
  try {
    const { pathname } = new URL(u);
    const m = pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i);
    return m ? m[0].toLowerCase() : ".jpg";
  } catch {
    return ".jpg";
  }
}

function searchUrl(site: "naver" | "google", query: string): string {
  const q = encodeURIComponent(query);
  return site === "naver"
    ? `https://search.naver.com/search.naver?where=image&sm=tab_jum&query=${q}`
    : `https://www.google.com/search?tbm=isch&q=${q}`;
}

// 한 사이트에서 img 전부를 훑는다(셀렉터 없이) — naturalWidth<120, sprite/logo/icon/
// blank/svg 제외, 중복 제거 후 limit개. lazy 로딩 유도를 위해 wheel(0,2200) 한 번(6-6).
async function collectFromSite(
  page: Page,
  query: string,
  site: "naver" | "google",
  limit: number
): Promise<ImageCandidate[]> {
  try {
    await page.goto(searchUrl(site, query), { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch {
    return [];
  }
  await page.mouse.wheel(0, 2200).catch(() => {});
  await page.waitForTimeout(500);

  const srcs: string[] = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("img").forEach((img) => {
      const el = img as HTMLImageElement;
      if (el.naturalWidth < 120) return;
      const src = el.currentSrc || el.src;
      if (!src) return;
      if (/sprite|logo|icon|blank|\.svg/i.test(src)) return;
      out.push(src);
    });
    return out;
  });

  const unique = Array.from(new Set(srcs));
  return unique.slice(0, limit).map((url) => ({ url, site }));
}

// 네이버 이미지 검색 → 실패(0건) 시 구글로 폴백.
export async function findCandidates(page: Page, query: string, limit: number): Promise<ImageCandidate[]> {
  const naver = await collectFromSite(page, query, "naver", limit);
  if (naver.length > 0) return naver;
  return collectFromSite(page, query, "google", limit);
}

// 3000바이트 미만이면 아이콘/깨진 이미지로 보고 버린다(6-6).
export async function downloadCandidate(
  context: BrowserContext,
  url: string,
  destPath: string
): Promise<boolean> {
  try {
    const res = await context.request.get(url, { timeout: 20_000 });
    if (!res.ok()) return false;
    const buf = await res.body();
    if (buf.byteLength < 3000) return false;
    await fs.promises.writeFile(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

export interface PickedImage {
  localPath: string;
  srcUrl: string;
  site: "naver" | "google";
  reason: string;
}

export interface RejectedImage {
  srcUrl: string;
  site: "naver" | "google";
  reason: string;
  category: string;
}

export interface PickResult {
  chosen: PickedImage | null;
  rejected: RejectedImage[];
}

// 한 자리(query)당: 후보를 하나씩 다운로드 → AI가 직접 보고 판정 → 첫 통과 이미지 채택(6-6).
export async function pickImageForSlot(
  page: Page,
  context: BrowserContext,
  saveDir: string,
  query: string,
  candidateLimit: number
): Promise<PickResult> {
  const candidates = await findCandidates(page, query, candidateLimit);
  const rejected: RejectedImage[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const destPath = path.join(saveDir, `crawl-${Date.now()}-${i}${extFromUrl(c.url)}`);
    const downloaded = await downloadCandidate(context, c.url, destPath);
    if (!downloaded) continue; // 다운로드 실패/너무 작음 — 판정 대상도 아니므로 조용히 건너뜀

    const verdict = await judgeCrawlImage(destPath, { query });
    if (verdict.watermark || verdict.koreanPerson || !verdict.fit) {
      rejected.push({
        srcUrl: c.url,
        site: c.site,
        reason: verdict.reason,
        category: categorizeCrawlRejection(verdict),
      });
      await fs.promises.unlink(destPath).catch(() => {});
      continue;
    }

    return { chosen: { localPath: destPath, srcUrl: c.url, site: c.site, reason: verdict.reason }, rejected };
  }

  return { chosen: null, rejected };
}

// images 테이블 기록 — 크롤링/생성 양쪽에서 공용으로 쓴다(채택/탈락 모두 남긴다).
// 탈락 사유가 DB에 남아야 워터마크·초상권 필터가 실제로 동작하는지 사용자가 확인할 수 있다(6-6).
export interface RecordImageRow {
  jobId: number;
  draftId?: number | null;
  query: string;
  srcUrl?: string | null;
  localPath?: string | null;
  sourceSite: ImageSite;
  verdictOk: boolean;
  verdictReason: string;
  sectionIndex: number;
  genPrompt?: string | null;
}

export function recordImage(row: RecordImageRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO images
       (job_id, draft_id, query, src_url, local_path, source_site, verdict_ok, verdict_reason, section_index, gen_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.jobId,
    row.draftId ?? null,
    row.query,
    row.srcUrl ?? null,
    row.localPath ?? null,
    row.sourceSite,
    row.verdictOk ? 1 : 0,
    row.verdictReason,
    row.sectionIndex,
    row.genPrompt ?? null
  );
}
