// 전체 오케스트레이션 (6-10).
//   auto:   수집 → 글감 → 본문 → (크롤링|AI생성|없음) → 발행
//   유형별:  (로컬사진 목록·설명) → 본문 → (로컬|크롤링|AI생성|없음) → 발행
import { getSettings } from "@/lib/settings";
import type { Settings } from "@/config";
import { jobLog } from "@/lib/log";
import {
  createJob,
  getJob,
  setJobStage,
  recordIdea,
  recordDraft,
  createPendingPost,
  finalizePost,
  getLastPublishedAt,
} from "@/lib/jobs";
import { newContext } from "@/lib/playwright";
import { collectTrends, saveSources, type CollectedItem } from "@/lib/scrape/trends";
import { generateIdeas, generateDraft, sanitizeDraft } from "@/lib/ai/content";
import { generateExperienceDraft, generateBrandingDraft } from "@/lib/ai/templates";
import { pickImageForSlot, recordImage } from "@/lib/scrape/images";
import { generateImageForSlot } from "@/lib/ai/imagegen";
import { listLocalPhotos, describeLocalPhotos, placeInOrder, placeByAiMatch } from "@/lib/localPhotos";
import { imagesDir } from "@/lib/paths";
import { publishToNaver, checkPublishGuard } from "@/lib/naver/publish";
import { verifySession } from "@/lib/naver/session";
import { publishedToday } from "@/lib/ai/cfUsage";
import type { Draft, Idea, JobInputs, Section, ImageSectionT } from "@/lib/types";
import { friendlyError } from "@/lib/friendlyError";

// 잡을 만들고 즉시 실행을 시작한다. jobId를 바로 반환하고, 실제 처리는
// fire-and-forget으로 백그라운드에서 진행된다(진행 상황은 SSE로 본다).
// ⚠️ API 라우트는 이 함수를 await 하지 말고 즉시 응답해야 한다(6-10).
export function startJob(keyword: string, inputs: JobInputs): number {
  const jobId = createJob(keyword, inputs.mode, inputs.mode === "auto", inputs);
  runJob(jobId).catch((err) => {
    const { summary, detail } = friendlyError(err);
    console.error(`[job ${jobId}] 처리 중 알 수 없는 오류(${detail}):`, err);
    try {
      jobLog(jobId, summary, "error");
      setJobStage(jobId, { status: "failed", error: summary });
    } catch {
      // DB조차 쓸 수 없는 상황이면 더 할 수 있는 게 없다.
    }
  });
  return jobId;
}

export async function runJob(jobId: number): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  let inputs: JobInputs;
  try {
    inputs = JSON.parse(job.inputs) as JobInputs;
  } catch {
    setJobStage(jobId, { status: "failed", error: "잡 입력값을 읽을 수 없습니다." });
    return;
  }

  try {
    let sources: CollectedItem[] = [];
    let draft: Draft;
    let photos: string[] = [];
    let photoDescs: string[] = [];

    if (inputs.mode === "auto") {
      // 1. 수집
      setJobStage(jobId, { status: "scraping", stage: "뉴스·블로그 수집 중" });
      const settings0 = getSettings();
      const scraped = await withBrowser(settings0, async (page) => {
        const collected = await collectTrends(page, inputs.keyword ?? "", settings0.scrapeTopN);
        return collected;
      });
      sources = [...scraped.news, ...scraped.blog];
      saveSources(jobId, sources);
      jobLog(jobId, `뉴스 ${scraped.news.length}건, 블로그 ${scraped.blog.length}건을 모았습니다.`);

      // 2. 글감
      setJobStage(jobId, { status: "writing", stage: "글감 뽑는 중" });
      const ideasRes = await generateIdeas(inputs.keyword ?? "", sources, 5);
      if (!ideasRes.ok) throw new Error(`글감 생성 실패: ${ideasRes.error}`);
      ideasRes.data.ideas.forEach((idea, i) => recordIdea(jobId, idea, i === 0));
      const idea: Idea = ideasRes.data.ideas[0];
      jobLog(jobId, `글감 ${ideasRes.data.ideas.length}개 중 "${idea.title}"을(를) 골랐습니다.`);

      // 3. 본문
      setJobStage(jobId, { status: "writing", stage: "본문 쓰는 중" });
      const draftRes = await generateDraft(inputs.keyword ?? "", idea, sources, {
        photoSource: inputs.photoSource,
      });
      if (!draftRes.ok) throw new Error(`본문 생성 실패: ${draftRes.error}`);
      draft = sanitizeAndLog(jobId, draftRes.data);
    } else {
      // (로컬 사진 목록·설명) → 본문
      if (inputs.photoSource === "local" && inputs.localFolder) {
        setJobStage(jobId, { status: "writing", stage: "사진 확인하는 중" });
        photos = listLocalPhotos(inputs.localFolder);
        if (photos.length === 0) {
          throw new Error("선택한 폴더에 쓸 수 있는 사진이 없습니다.");
        }
        // ⚠️ 본문 생성 "전에 한 번만" 만들고 재사용한다 — 두 번 만들면
        // claude 호출이 배로 든다(6-8, 6-10).
        photoDescs = await describeLocalPhotos(photos);
        jobLog(jobId, `사진 ${photos.length}장의 설명을 만들었습니다.`);
      }

      setJobStage(jobId, { status: "writing", stage: "본문 쓰는 중" });
      const topic = inputs.topic ?? "";
      const keyContent = inputs.keyContent ?? "";
      const photoCount = inputs.photoSource === "local" ? photos.length : 0;
      const draftRes =
        inputs.mode === "experience"
          ? await generateExperienceDraft(topic, keyContent, inputs.photoSource, photoCount, photoDescs)
          : await generateBrandingDraft(topic, keyContent, inputs.photoSource, photoCount, photoDescs);
      if (!draftRes.ok) throw new Error(`본문 생성 실패: ${draftRes.error}`);
      draft = sanitizeAndLog(jobId, draftRes.data);
    }

    const draftId = recordDraft(jobId, null, draft.title, draft.sections);
    jobLog(jobId, `초안을 저장했습니다 — 섹션 ${draft.sections.length}개.`);

    // 4. 이미지
    setJobStage(jobId, { status: "imaging", stage: "사진 준비하는 중" });
    const settings = getSettings();
    const imagePaths = await fillImages(jobId, draftId, draft, {
      photoSource: inputs.photoSource,
      imageStyle: inputs.imageStyle ?? "photo",
      photos,
      photoDescs,
      placementMode: inputs.placementMode ?? "order",
      settings,
    });

    // 5. 발행
    await publishStage(jobId, draftId, draft, imagePaths, inputs, settings);
  } catch (err) {
    const { summary, detail } = friendlyError(err);
    console.error(`[job ${jobId}] 오류로 중단됨(${detail}):`, err);
    jobLog(jobId, summary, "error");
    setJobStage(jobId, { status: "failed", error: summary });
  }
}

function sanitizeAndLog(jobId: number, rawDraft: Draft): Draft {
  const { draft, droppedHighlights } = sanitizeDraft(rawDraft);
  if (droppedHighlights > 0) {
    jobLog(jobId, `본문에 없는 강조 구절 ${droppedHighlights}개는 형광펜 없이 처리했습니다.`, "warn");
  }
  return draft;
}

async function withBrowser<T>(settings: Settings, fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
  const { browser, context } = await newContext({ headless: !settings.showBrowser });
  try {
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ── 이미지 채우기 ────────────────────────────────────────────────
export interface FillImagesOpts {
  photoSource: JobInputs["photoSource"];
  imageStyle: NonNullable<JobInputs["imageStyle"]>;
  photos: string[];
  photoDescs: string[];
  placementMode: "order" | "ai";
  settings: Settings;
}

function imageSectionCaption(section: ImageSectionT): string {
  return section.caption ?? section.query;
}

export async function fillImages(
  jobId: number,
  draftId: number,
  draft: Draft,
  opts: FillImagesOpts
): Promise<Record<number, string>> {
  const imageIndexes = draft.sections
    .map((s, i) => (s.type === "image" ? i : -1))
    .filter((i) => i >= 0);
  const result: Record<number, string> = {};
  if (imageIndexes.length === 0 || opts.photoSource === "none") return result;

  const saveDir = imagesDir(jobId);

  if (opts.photoSource === "local") {
    const captions = imageIndexes.map((i) => imageSectionCaption(draft.sections[i] as ImageSectionT));
    const placed =
      opts.placementMode === "ai"
        ? await placeByAiMatch(opts.photos, opts.photoDescs, captions)
        : placeInOrder(opts.photos, opts.photoDescs, captions.length);

    placed.forEach((p, i) => {
      const sectionIndex = imageIndexes[i];
      result[sectionIndex] = p.path;
      recordImage({
        jobId,
        draftId,
        query: captions[i] ?? "",
        localPath: p.path,
        sourceSite: "local",
        verdictOk: true,
        verdictReason: "사용자가 직접 찍은 사진(워터마크·초상권 필터 미적용)",
        sectionIndex,
      });
    });
    jobLog(jobId, `내 사진 ${placed.length}장을 배치했습니다.`);
    return result;
  }

  if (opts.photoSource === "crawl") {
    await withBrowser(opts.settings, async (page) => {
      const context = page.context();
      for (const sectionIndex of imageIndexes) {
        const section = draft.sections[sectionIndex] as ImageSectionT;
        const pick = await pickImageForSlot(page, context, saveDir, section.query, opts.settings.imageCandidates);
        for (const r of pick.rejected) {
          recordImage({
            jobId,
            draftId,
            query: section.query,
            srcUrl: r.srcUrl,
            sourceSite: r.site,
            verdictOk: false,
            verdictReason: `${r.category}: ${r.reason}`,
            sectionIndex,
          });
        }
        if (pick.chosen) {
          recordImage({
            jobId,
            draftId,
            query: section.query,
            srcUrl: pick.chosen.srcUrl,
            localPath: pick.chosen.localPath,
            sourceSite: pick.chosen.site,
            verdictOk: true,
            verdictReason: pick.chosen.reason,
            sectionIndex,
          });
          result[sectionIndex] = pick.chosen.localPath;
        } else {
          jobLog(
            jobId,
            `${sectionIndex}번 자리: 후보 사진 ${pick.rejected.length}개가 전부 탈락해 사진 없이 넘어갑니다.`,
            "warn"
          );
        }
      }
    });
    return result;
  }

  // ai
  for (const sectionIndex of imageIndexes) {
    const section = draft.sections[sectionIndex] as ImageSectionT;
    const contextSnippets = pickContextSnippets(draft.sections, sectionIndex);
    const gen = await generateImageForSlot({
      title: draft.title,
      caption: section.caption,
      contextSnippets,
      style: opts.imageStyle,
      steps: opts.settings.cfImageSteps,
      saveDir,
      fileBaseName: `ai-${sectionIndex}`,
    });
    for (const attempt of gen.attempts) {
      recordImage({
        jobId,
        draftId,
        query: section.query,
        localPath: attempt.localPath,
        sourceSite: "ai",
        verdictOk: attempt.ok,
        verdictReason: attempt.reason,
        sectionIndex,
        genPrompt: attempt.prompt || undefined,
      });
    }
    if (gen.chosen) {
      result[sectionIndex] = gen.chosen.localPath;
    } else {
      jobLog(jobId, `${sectionIndex}번 자리: AI 이미지 생성에 실패해 사진 없이 넘어갑니다.`, "warn");
    }
  }
  return result;
}

// 이미지 자리 앞뒤 ±3섹션에서 텍스트가 있는 것 2개(400자)를 문맥으로 뽑는다(6-7).
export function pickContextSnippets(sections: Section[], index: number): string[] {
  const out: string[] = [];
  for (let offset = 1; offset <= 3 && out.length < 2; offset++) {
    for (const i of [index - offset, index + offset]) {
      if (out.length >= 2) break;
      const s = sections[i];
      if (!s) continue;
      const text = s.type === "heading" || s.type === "quote" || s.type === "paragraph" ? s.text : null;
      if (text) out.push(text.slice(0, 400));
    }
  }
  return out;
}

// ── 발행 단계 ────────────────────────────────────────────────────
async function publishStage(
  jobId: number,
  draftId: number,
  draft: Draft,
  imagePaths: Record<number, string>,
  inputs: JobInputs,
  settings: Settings
): Promise<void> {
  setJobStage(jobId, { status: "publishing", stage: "에디터에 작성하는 중" });
  const postId = createPendingPost(jobId, draftId);

  // 발행 가드는 연습 모드가 아닐 때만 검사한다(6-9 발행 가드).
  if (!settings.dryRun) {
    const guard = checkPublishGuard(settings, publishedToday(), getLastPublishedAt());
    if (guard.blocked) {
      jobLog(jobId, guard.reason, "warn");
      finalizePost(postId, { status: "blocked", note: guard.reason, published: false });
      setJobStage(jobId, { status: "failed", stage: "발행 차단됨", error: guard.reason });
      return;
    }
  }

  // ⚠️ 세션 확인은 연습 모드 여부와 무관하게 항상 필요하다 — 연습 모드도 실제
  // 에디터 화면까지는 들어가서 스크린샷을 찍는다(2-5). dryRun에 따라 건너뛰는 건
  // 바로 위의 발행 가드(kill-switch/한도/간격)뿐이다.
  const session = await verifySession();
  if (!session.valid) {
    jobLog(jobId, `네이버 로그인이 필요합니다: ${session.reason}`, "error");
    finalizePost(postId, {
      status: "failed",
      note: `네이버 로그인이 필요합니다: ${session.reason}`,
      published: false,
    });
    setJobStage(jobId, { status: "failed", error: session.reason });
    return;
  }
  const blogId = session.blogId;

  // ⚠️ 발행 단계에 15분 상한을 건다 — 에디터가 멈추면 잡이 영원히 publishing으로
  // 남는다(6-10).
  const TIMEOUT_MS = 15 * 60_000;
  const publishPromise = publishToNaver(
    {
      jobId,
      title: draft.title,
      sections: draft.sections,
      imagePaths,
      visibility: settings.visibility,
      dryRun: settings.dryRun,
      headingAsQuote: inputs.mode !== "auto",
      blogId,
      useNaverSession: true,
      headless: !settings.showBrowser,
    },
    (msg, level) => jobLog(jobId, msg, level)
  );
  const timedOut = Symbol("timeout");
  const raced = await Promise.race([
    publishPromise,
    new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), TIMEOUT_MS)),
  ]);

  if (raced === timedOut) {
    finalizePost(postId, { status: "failed", note: "발행이 15분을 넘어 중단되었습니다.", published: false });
    setJobStage(jobId, { status: "failed", error: "발행 시간 초과(15분)" });
    jobLog(jobId, "발행이 15분을 넘어 중단되었습니다.", "error");
    return;
  }

  const result = raced;
  finalizePost(postId, {
    status: result.status,
    blogUrl: result.blogUrl,
    screenshot: result.screenshotPath,
    note: result.note,
    published: result.status === "published",
  });

  if (result.status === "failed") {
    setJobStage(jobId, { status: "failed", error: result.note });
    jobLog(jobId, `발행에 실패했습니다: ${result.note}`, "error");
  } else {
    setJobStage(jobId, {
      status: "done",
      stage: result.status === "published" ? "발행 완료" : "연습 완료",
    });
    jobLog(jobId, result.note);
  }
}
