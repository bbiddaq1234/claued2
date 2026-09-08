// AI 응답 구조 검증용 Zod 스키마 전부 (6장 파일구조).
import { z } from "zod";

export const PhotoSourceSchema = z.enum(["none", "local", "ai", "crawl"]);
export type PhotoSource = z.infer<typeof PhotoSourceSchema>;

export const ImageStyleSchema = z.enum(["photo", "illust"]);
export type ImageStyle = z.infer<typeof ImageStyleSchema>;

export const ModeSchema = z.enum(["auto", "experience", "branding"]);
export type Mode = z.infer<typeof ModeSchema>;

// ── 섹션 모델 (6-5) — 글은 문자열이 아니라 섹션 배열이다 ──────────────
export const HeadingSection = z.object({
  type: z.literal("heading"),
  text: z.string().min(1),
});
export type HeadingSectionT = z.infer<typeof HeadingSection>;

export const ParagraphSection = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1),
  // highlight: text 안에 글자 그대로 있는 핵심 구절. 형광펜(노랑)+굵게로 처리된다.
  // ⚠️ AI가 본문에 없는 highlight를 지어내는 경우가 있다(7-24, 실측 20%).
  // sanitizeDraft()가 생성 직후 한 번, 타이핑 직전에 한 번 더(이중 방어) 걸러낸다.
  highlight: z.string().min(1).optional(),
});
export type ParagraphSectionT = z.infer<typeof ParagraphSection>;

export const QuoteSection = z.object({
  type: z.literal("quote"),
  text: z.string().min(1),
});
export type QuoteSectionT = z.infer<typeof QuoteSection>;

export const DividerSection = z.object({
  type: z.literal("divider"),
});
export type DividerSectionT = z.infer<typeof DividerSection>;

export const ImageSection = z.object({
  type: z.literal("image"),
  // photoSource에 따라 의미가 다르다: crawl=검색어, ai=장면 묘사, local=사진 설명.
  query: z.string().min(1),
  caption: z.string().optional(),
});
export type ImageSectionT = z.infer<typeof ImageSection>;

export const SectionSchema = z.discriminatedUnion("type", [
  HeadingSection,
  ParagraphSection,
  QuoteSection,
  DividerSection,
  ImageSection,
]);
export type Section = z.infer<typeof SectionSchema>;

// ── 글감 ──────────────────────────────────────────────────────────
export const IdeaSchema = z.object({
  title: z.string().min(1),
  angle: z.string().min(1),
  rationale: z.string().min(1),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const IdeasResponseSchema = z.object({
  ideas: z.array(IdeaSchema).min(1),
});
export type IdeasResponse = z.infer<typeof IdeasResponseSchema>;

// ── 초안 ──────────────────────────────────────────────────────────
// ⚠️ 이 refine을 모든 모드에 무조건 적용하면 안 된다(6-5 경고).
// 사진 소스별로 이미지 섹션 개수 요구가 다르다:
//   crawl/ai  → 6개 이상 (일부는 적합 사진을 못 찾으므로 넉넉히)
//   local     → 정확히 사진 장수만큼 (4장뿐이면 6개는 애초에 못 만든다)
//   none      → 0개
export function draftSchemaFor(photoSource: PhotoSource, photoCount = 0) {
  const base = z.object({
    title: z.string().min(1),
    sections: z.array(SectionSchema).min(1),
  });

  function requirementText(): string {
    if (photoSource === "crawl" || photoSource === "ai") return "6개 이상";
    if (photoSource === "local") return `정확히 ${photoCount}개`;
    return "0개";
  }

  function countOk(imageCount: number): boolean {
    if (photoSource === "crawl" || photoSource === "ai") return imageCount >= 6;
    if (photoSource === "local") return imageCount === photoCount;
    return imageCount === 0;
  }

  return base.superRefine((draft, ctx) => {
    const imageCount = draft.sections.filter((s) => s.type === "image").length;
    if (!countOk(imageCount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `이미지 섹션이 ${imageCount}개인데, 사진 소스(${photoSource}) 기준으로는 ${requirementText()}이어야 합니다.`,
        path: ["sections"],
      });
    }
  });
}
export type Draft = z.infer<ReturnType<typeof draftSchemaFor>>;

// ── 이미지 비전 판정 (6-6) ───────────────────────────────────────
export const CrawlVerdictSchema = z.object({
  fit: z.boolean(),
  watermark: z.boolean(),
  koreanPerson: z.boolean(),
  reason: z.string(),
});
export type CrawlVerdict = z.infer<typeof CrawlVerdictSchema>;

// 생성 이미지 판정 — 워터마크/초상권은 원천적으로 없으므로 다른 네 가지만 본다(7-13).
export const GenVerdictSchema = z.object({
  ok: z.boolean(),
  topicMismatch: z.boolean(),
  distorted: z.boolean(),
  textArtifact: z.boolean(),
  lowQuality: z.boolean(),
  reason: z.string(),
});
export type GenVerdict = z.infer<typeof GenVerdictSchema>;

// ── 작성 화면 입력 (1장, 6-10) ────────────────────────────────────
// auto: keyword만. experience/branding: topic+keyContent(+로컬 사진).
// 자동 발굴에는 photoSource "local"이 없다 — 주제를 미리 모르기 때문이다.
export const JobInputsSchema = z
  .object({
    mode: ModeSchema,
    keyword: z.string().optional(),
    topic: z.string().optional(),
    keyContent: z.string().optional(),
    photoSource: PhotoSourceSchema,
    imageStyle: ImageStyleSchema.optional(),
    localFolder: z.string().optional(),
    placementMode: z.enum(["order", "ai"]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "auto") {
      if (!v.keyword?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "관심 키워드를 입력하세요.", path: ["keyword"] });
      }
      if (v.photoSource === "local") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "자동 발굴에서는 '내 사진'을 쓸 수 없습니다(주제를 미리 모릅니다).",
          path: ["photoSource"],
        });
      }
    } else {
      if (!v.topic?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "주제를 입력하세요.", path: ["topic"] });
      }
      if (!v.keyContent?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "핵심 내용을 입력하세요.", path: ["keyContent"] });
      }
    }
    if (v.photoSource === "local" && !v.localFolder?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "사진 폴더를 선택하세요.", path: ["localFolder"] });
    }
  });
export type JobInputs = z.infer<typeof JobInputsSchema>;
