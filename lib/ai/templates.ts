// 체험단·브랜딩 유형별 프롬프트 (6-5).
import { runClaudeJson } from "@/lib/claude";
import { draftSchemaFor, type PhotoSource } from "@/lib/types";

// 사진 소스별로 image 섹션의 query가 뜻하는 바와, 몇 개를 만들지가 완전히 다르다.
export function photoHintFor(photoSource: PhotoSource, count: number, descs?: string[]): string {
  switch (photoSource) {
    case "none":
      return "사진은 쓰지 않습니다. image 섹션을 하나도 만들지 마세요.";
    case "local": {
      const list = descs?.length
        ? `사용 가능한 사진 설명 목록:\n${descs.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
        : `사용 가능한 사진이 ${count}장 있습니다.`;
      return [
        `image 섹션을 정확히 ${count}개 만드세요(더 많거나 적으면 안 됩니다).`,
        `query에는 검색어가 아니라 "그 자리에 어떤 사진이 어울리는지"에 대한 설명을 쓰세요.`,
        list,
      ].join("\n");
    }
    case "ai":
      return [
        "image 섹션을 6~8개 배치하세요(일부는 이미지 생성에 실패할 수 있으므로 넉넉히 배치합니다).",
        "query에는 어떤 장면을 그려야 하는지 한국어로 구체적으로 묘사하세요(피사체·구도·분위기를 포함).",
      ].join("\n");
    case "crawl":
      return [
        "image 섹션을 6~8개 배치하세요(일부는 적합한 사진을 찾지 못할 수 있으므로 넉넉히 배치합니다).",
        "query에는 이미지 검색에 쓸 검색어를 쓰세요.",
      ].join("\n");
  }
}

const SECTION_FORMAT = `
각 섹션은 "type" 필드를 가진 JSON 객체입니다. type은 다음 중 하나:
- heading: {"type":"heading","text":"..."}
- paragraph: {"type":"paragraph","text":"...","highlight":"..."(선택)}
- quote: {"type":"quote","text":"..."}
- divider: {"type":"divider"}
- image: {"type":"image","query":"...","caption":"..."(선택)}

JSON 형식: {"title":"...", "sections":[...]}
`.trim();

const NO_MARKDOWN =
  "마크다운 기호(**, ~~, ~, #, >, 백틱, 줄머리 -)를 절대 쓰지 말 것 — 일반 텍스트로만 쓸 것";

export async function generateExperienceDraft(
  topic: string,
  keyContent: string,
  photoSource: PhotoSource,
  photoCount: number,
  photoDescs?: string[]
) {
  const prompt = `
당신은 체험단 후기를 쓰는 블로거입니다. 실제로 방문/사용해본 사람의 1인칭 후기체로 씁니다.

주제: ${topic}
핵심 내용(사용자가 준 정보):
${keyContent}

문체·구조 지시:
- 철저히 1인칭("저희는", "~했어요", "~더라구요")으로 쓸 것
- "ㅎㅎ", "진짜" 같은 구어체 표현을 자연스럽게 섞을 것(과하지 않게)
- 도입에서 결론(총평)을 살짝 흘려서 궁금증을 유발할 것
- 실용정보는 구획을 나눠서 다룰 것(가는 법 / 웨이팅 / 가격 / 언제 갈지 / 주의점 중 해당하는 것)
- 소제목은 heading이 아니라 quote 섹션으로, 15~30자의 짧은 한 줄로 쓸 것
- 문단은 2~4줄로 짧게 끊을 것
- 문단 1~2개마다 사진 1장이 오는 리듬으로 image 섹션을 배치할 것
- 마무리는 총평 + "다시 간다면"의 팁으로 끝낼 것
- ${NO_MARKDOWN}

${photoHintFor(photoSource, photoCount, photoDescs)}

${SECTION_FORMAT}
`.trim();

  return runClaudeJson(prompt, draftSchemaFor(photoSource, photoCount));
}

export async function generateBrandingDraft(
  topic: string,
  keyContent: string,
  photoSource: PhotoSource,
  photoCount: number,
  photoDescs?: string[]
) {
  const prompt = `
당신은 자신의 분야에서 전문성을 보여주는 브랜딩 글을 쓰는 전문가입니다.
"~입니다" 체의 단정한 전문가 어투로 씁니다.

주제: ${topic}
핵심 내용(사용자가 준 정보 — 숫자·실적을 포함해 반드시 이 안에서만 쓸 것. 지어내지 말 것):
${keyContent}

구조를 반드시 이 순서로 고정할 것:
① 권위 선점(사용자가 준 숫자·실적으로) ② 독자의 문제/오해 짚기 ③ 왜 기존 방법이 안 통하는지
④ 이름을 붙인 자체 프레임워크 제시 ⑤ 예상되는 반박에 대한 Q&A ⑥ 정리 + 행동 유도(CTA)

지시:
- "~입니다" 전문가체를 유지할 것
- 소제목은 heading이 아니라 quote 섹션으로, 15~30자의 짧은 한 줄로 쓸 것
- 문단은 2~4줄로 짧게 끊을 것
- 구획 전환에 divider를 1~2회 넣을 것
- 숫자·실적을 지어내지 말 것 — 사용자가 준 핵심 내용 안에 있는 것만 쓸 것
- ${NO_MARKDOWN}

${photoHintFor(photoSource, photoCount, photoDescs)}

${SECTION_FORMAT}
`.trim();

  return runClaudeJson(prompt, draftSchemaFor(photoSource, photoCount));
}
