// 글감·본문 생성 프롬프트 — 자동 발굴 모드 (6-5).
import { runClaudeJson } from "@/lib/claude";
import {
  IdeasResponseSchema,
  draftSchemaFor,
  type Idea,
  type Draft,
  type ParagraphSectionT,
  type PhotoSource,
} from "@/lib/types";
import { photoHintFor } from "@/lib/ai/templates";

export interface SourceLike {
  type: "news" | "blog";
  title: string;
  summary: string;
}

// 수집 자료를 번호 매긴 텍스트 블록(각 400자)으로 압축한다.
function formatSources(sources: SourceLike[]): string {
  return sources
    .map((s, i) => {
      const label = s.type === "news" ? "뉴스" : "블로그";
      const body = `${s.title}\n${s.summary}`.slice(0, 400);
      return `${i + 1}. [${label}] ${body}`;
    })
    .join("\n\n");
}

export async function generateIdeas(keyword: string, sources: SourceLike[], n = 5) {
  const block = formatSources(sources);
  const prompt = `
당신은 네이버 블로그 상위 노출 전문 콘텐츠 기획자입니다.
아래는 "${keyword}" 관련 최근 뉴스·블로그 자료입니다.

${block || "(자료 없음)"}

이 자료를 참고해서 블로그 글감 ${n}개를 제안하세요.
각 글감은 제목(title), 관점(angle — 이 글이 다른 글과 다르게 접근하는 지점),
근거(rationale — 왜 지금 이 소재가 반응이 좋을지)를 포함합니다.

JSON 형식: {"ideas": [{"title":"...", "angle":"...", "rationale":"..."}, ...]}
`.trim();

  return runClaudeJson(prompt, IdeasResponseSchema);
}

export interface GenerateDraftOpts {
  photoSource: PhotoSource; // 자동 발굴에는 'local'이 없다 — 주제를 미리 모르므로(1장)
  photoCount?: number;
}

export async function generateDraft(
  keyword: string,
  idea: Idea,
  sources: SourceLike[],
  opts: GenerateDraftOpts
) {
  const block = formatSources(sources);
  const prompt = `
당신은 네이버 블로그에 자연스러운 글을 쓰는 작가입니다.

키워드: ${keyword}
주제: ${idea.title}
관점: ${idea.angle}

참고 자료(그대로 베끼지 말고 참고만 하세요):
${block || "(자료 없음)"}

아래 지시를 반드시 지키세요:
- 수집 자료를 참고하되 문장을 그대로 베끼지 말 것
- 사람이 쓴 듯한 자연스러운 구어체로 쓸 것. "결론적으로", "요약하자면" 같은 AI 티 나는
  상투적 표현은 쓰지 말 것
- 구조: 도입(공감·후킹) → 본문(소제목 2~4구획) → 마무리(요약·행동유도)
- 문단마다 highlight는 최대 1개, 전체 문단의 30% 정도만 지정할 것. highlight는 반드시
  그 문단 text 안에 있는 문구를 글자 그대로 가져올 것 — 새로 지어내지 말 것
- 사진을 쓰는 경우, 이미지 자리를 6~8개 배치할 것(일부는 적합한 사진을 못 찾으므로 넉넉히)
- 이미지 검색어(image 섹션의 query)는 사람 얼굴이 주인공이 아닌 사물·풍경·클로즈업·손동작
  위주로 쓸 것
- 마크다운 기호(**, ~~, ~, #, >, 백틱, 줄머리 -)를 절대 쓰지 말 것 — 일반 텍스트로만 쓸 것

${photoHintFor(opts.photoSource, opts.photoCount ?? 0)}

각 섹션은 "type" 필드를 가진 JSON 객체입니다. type은 다음 중 하나:
- heading: {"type":"heading","text":"..."}
- paragraph: {"type":"paragraph","text":"...","highlight":"..."(선택)}
- quote: {"type":"quote","text":"..."}
- divider: {"type":"divider"}
- image: {"type":"image","query":"...","caption":"..."(선택)}

JSON 형식: {"title":"...", "sections":[...]}
`.trim();

  return runClaudeJson(prompt, draftSchemaFor(opts.photoSource, opts.photoCount ?? 0));
}

// ⚠️ AI가 본문에 없는 highlight를 지어낸다(실측 5개 중 1개, 7-24).
// 형광펜은 text.indexOf(highlight)로 자리를 찾으므로, 없으면 그 highlight만
// 떨어뜨린다 — 초안 전체를 재생성시키지 않는다(재생성엔 100초가 든다. 이미지 자리
// 개수는 재생성할 가치가 있지만 highlight는 아니다).
export function sanitizeDraft(draft: Draft): { draft: Draft; droppedHighlights: number } {
  let dropped = 0;
  const sections = draft.sections.map((s) => {
    if (s.type === "paragraph" && s.highlight) {
      if (!s.text.includes(s.highlight)) {
        dropped++;
        const rest: ParagraphSectionT = { type: "paragraph", text: s.text };
        return rest;
      }
    }
    return s;
  });
  return { draft: { ...draft, sections }, droppedHighlights: dropped };
}
