// AI 이미지 생성 3단계 — Cloudflare Workers AI (6-7).
import fs from "node:fs";
import path from "node:path";
import { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } from "@/config";
import { runClaude, runClaudeJson } from "@/lib/claude";
import { GenVerdictSchema, type GenVerdict, type ImageStyle } from "@/lib/types";

const STYLE_TOKENS: Record<ImageStyle, string> = {
  photo: "photorealistic photograph, natural lighting, shallow depth of field, 50mm lens, high detail",
  illust: "clean flat vector illustration, simple shapes, soft muted color palette, minimal, lots of white space",
};
const FORBIDDEN_SUFFIX = "no text, no letters, no words, no watermark, no logo";

export interface DesignPromptOpts {
  title: string;
  caption?: string;
  contextSnippets: string[]; // 앞뒤 ±3섹션에서 최대 2개, 400자
  style: ImageStyle;
  feedback?: string; // 재생성 시 부적합 사유를 되먹인다
}

// ① claude -p가 FLUX용 영문 프롬프트를 설계한다.
export async function designImagePrompt(
  opts: DesignPromptOpts
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  const prompt = `
당신은 FLUX 이미지 생성 모델을 위한 영문 프롬프트를 설계하는 전문가입니다.

블로그 글 제목: ${opts.title}
이 사진이 들어갈 자리의 설명: ${opts.caption ?? "(설명 없음)"}
앞뒤 문맥:
${opts.contextSnippets.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(없음)"}
${opts.feedback ? `\n이전 생성이 부적합했던 이유(이번엔 반영해서 설계할 것): ${opts.feedback}` : ""}

아래 규칙을 반드시 지켜 영문 프롬프트를 한 문단(40단어 이내)으로 작성하세요:
- 영어로만 쓸 것
- 피사체/구도/조명/배경/질감을 명시할 것
- 다음 스타일 토큰을 반드시 포함할 것: "${STYLE_TOKENS[opts.style]}"
- 끝에 반드시 이 문구를 포함할 것: "${FORBIDDEN_SUFFIX}"
- 실존 인물·유명인·브랜드 로고를 절대 넣지 말 것
- 사람이 필요하면 얼굴이 크게 안 나오는 구도(손·뒷모습·실루엣)로 쓸 것
- 한국적 맥락은 반영하되 한글 간판 등 텍스트는 절대 넣지 말 것(생성 모델이 한글을 깨뜨림)

프롬프트 문장만 출력하세요. 설명이나 따옴표 없이 한 줄로.
`.trim();

  const res = await runClaude(prompt);
  if (!res.ok) return { ok: false, error: res.error };

  let text = res.text.trim().replace(/^["']|["']$/g, "");
  // 고정 규칙은 AI가 빠뜨릴 수 있으므로 코드에서 한 번 더 보장한다.
  if (!text.toLowerCase().includes(STYLE_TOKENS[opts.style].split(",")[0].toLowerCase())) {
    text += `, ${STYLE_TOKENS[opts.style]}`;
  }
  if (!text.toLowerCase().includes("no watermark")) {
    text += `, ${FORBIDDEN_SUFFIX}`;
  }
  return { ok: true, prompt: text };
}

// ② Cloudflare Workers AI 호출. 응답은 바이너리가 아니라 base64 JSON이다(6-7).
export async function generateImageCF(
  prompt: string,
  steps: number
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    return { ok: false, error: "Cloudflare 열쇠가 설정되지 않았습니다." };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, steps: Math.min(Math.max(Math.round(steps), 1), 8) }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Cloudflare API 오류(${res.status}): ${text.slice(0, 300)}` };
    }

    const contentType = res.headers.get("content-type") || "";
    let buffer: Buffer;
    if (contentType.includes("application/json")) {
      const json: any = await res.json();
      const b64 = json?.result?.image;
      if (!b64) {
        return {
          ok: false,
          error: json?.errors?.length ? JSON.stringify(json.errors) : "이미지 응답이 비어 있습니다.",
        };
      }
      buffer = Buffer.from(b64, "base64");
    } else {
      // SDXL 계열은 바이너리를 준다 — content-type으로 분기해두면 모델 교체가 쉽다.
      const ab = await res.arrayBuffer();
      buffer = Buffer.from(ab);
    }

    if (buffer.byteLength < 2000) {
      return { ok: false, error: "생성된 이미지가 너무 작습니다(생성 실패로 간주)." };
    }
    return { ok: true, buffer };
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? "이미지 생성이 90초 안에 끝나지 않았습니다." : String((err as Error)?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ③ 검증 — 크롤링용 판정함수를 재사용하지 않는다(7-13). 생성물에는 워터마크·초상권이
// 원천적으로 없으므로 "주제 불일치/형태 깨짐/글자 혼입/저품질" 네 가지만 본다.
async function judgeGeneratedImage(
  imagePath: string,
  opts: { title: string; caption?: string }
): Promise<GenVerdict> {
  const prompt = `
당신은 AI가 생성한 블로그용 이미지를 심사하는 검수자입니다.
이 이미지는 블로그 글 "${opts.title}"의 ${opts.caption ? `"${opts.caption}"` : "본문"} 자리에 쓰일 예정입니다.

아래 네 가지 문제만 판정하세요(워터마크·초상권은 생성 이미지라 해당 없음):
- topicMismatch: 주제와 명백히 안 어울리면 true
- distorted: 형태가 부자연스럽게 깨져 있으면(이상한 손가락, 뒤틀린 구조 등) true
- textArtifact: 이미지 안에 깨진 글자·의미 없는 문자가 보이면 true
- lowQuality: 흐릿하거나 노이즈가 심해 품질이 낮으면 true

ok는 위 네 가지가 전부 false일 때만 true로 판정하세요.

JSON 형식: {"ok": true|false, "topicMismatch": true|false, "distorted": true|false, "textArtifact": true|false, "lowQuality": true|false, "reason": "판정 이유 한 문장"}
`.trim();

  const res = await runClaudeJson(prompt, GenVerdictSchema, { images: [imagePath] });
  if (!res.ok) {
    return {
      ok: false,
      topicMismatch: false,
      distorted: false,
      textArtifact: false,
      lowQuality: false,
      reason: `판정 실패: ${res.error}`,
    };
  }
  return res.data;
}

export interface GenerateSlotOpts {
  title: string;
  caption?: string;
  contextSnippets: string[];
  style: ImageStyle;
  steps: number;
  saveDir: string;
  fileBaseName: string;
}

export interface SlotAttempt {
  prompt: string;
  ok: boolean;
  reason: string;
  localPath?: string;
}

export interface GenerateSlotResult {
  chosen: { localPath: string; prompt: string } | null;
  attempts: SlotAttempt[];
}

// 부적합하면 그 이유를 프롬프트 설계에 되먹여 1회만 재생성한다. 그래도 실패하면
// 그 자리는 건너뛴다 — 무한 루프 금지(6-7).
export async function generateImageForSlot(opts: GenerateSlotOpts): Promise<GenerateSlotResult> {
  const attempts: SlotAttempt[] = [];
  let feedback: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const designed = await designImagePrompt({
      title: opts.title,
      caption: opts.caption,
      contextSnippets: opts.contextSnippets,
      style: opts.style,
      feedback,
    });
    if (!designed.ok) {
      attempts.push({ prompt: "", ok: false, reason: `프롬프트 설계 실패: ${designed.error}` });
      break;
    }

    const gen = await generateImageCF(designed.prompt, opts.steps);
    if (!gen.ok) {
      attempts.push({ prompt: designed.prompt, ok: false, reason: gen.error });
      feedback = gen.error;
      continue;
    }

    const destPath = path.join(opts.saveDir, `${opts.fileBaseName}-${attempt}.png`);
    await fs.promises.writeFile(destPath, gen.buffer);

    const verdict = await judgeGeneratedImage(destPath, { title: opts.title, caption: opts.caption });
    if (verdict.ok) {
      attempts.push({ prompt: designed.prompt, ok: true, reason: verdict.reason, localPath: destPath });
      return { chosen: { localPath: destPath, prompt: designed.prompt }, attempts };
    }

    const reasonLabel = verdict.reason.startsWith("판정 실패")
      ? verdict.reason
      : `${verdict.reason} (topicMismatch:${verdict.topicMismatch}, distorted:${verdict.distorted}, textArtifact:${verdict.textArtifact}, lowQuality:${verdict.lowQuality})`;
    attempts.push({ prompt: designed.prompt, ok: false, reason: reasonLabel, localPath: destPath });
    feedback = reasonLabel;
    await fs.promises.unlink(destPath).catch(() => {});
  }

  return { chosen: null, attempts };
}
