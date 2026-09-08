// 로컬 사진 목록·설명·배치 (6-8).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { runClaude, runClaudeJson } from "@/lib/claude";

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

// ~ 는 $HOME으로 확장한다.
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// 폴더를 읽어 이미지 확장자만, 파일명 자연순 정렬(사진1, 사진2, ..., 사진10 순서가
// 사전식으로 사진1, 사진10, 사진2가 되지 않게 numeric 옵션을 쓴다).
export function listLocalPhotos(folder: string): string[] {
  const dir = expandHome(folder);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => ALLOWED_EXT.has(path.extname(name).toLowerCase()));

  files.sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));

  return files.map((name) => path.join(dir, name));
}

// ⚠️ 사용자가 직접 찍은 사진이므로 워터마크·초상권 필터(lib/ai/vision.ts)를 적용하지
// 않는다 — 그건 출처를 알 수 없는 크롤링 이미지에만 필요한 검사다(6-8).

// 사진마다 claude로 한 줄 설명(30자)을 만든다.
// ⚠️ 본문 생성 "전에 한 번만" 호출하고, 그 결과를 프롬프트(photoHintFor)와
// 배치(placeByAiMatch) 양쪽에서 재사용해야 한다 — 두 번 만들면 claude 호출이
// 배로 든다(6-8, 6-10 경고).
export async function describeLocalPhotos(photoPaths: string[]): Promise<string[]> {
  const descs: string[] = [];
  for (const p of photoPaths) {
    const res = await runClaude(
      "이 사진을 블로그 글에 넣을 때 참고할 수 있게 한 줄(30자 이내)로 설명해줘. 설명 문장만 출력해.",
      { images: [p] }
    );
    descs.push(res.ok ? res.text.trim().slice(0, 60) : "(설명 생성 실패)");
  }
  return descs;
}

export type PlacementMode = "order" | "ai";

export interface PlacedPhoto {
  path: string;
  desc: string;
}

// order: 글 흐름 순서대로 순차 배치.
export function placeInOrder(photoPaths: string[], descs: string[], slotCount: number): PlacedPhoto[] {
  const out: PlacedPhoto[] = [];
  for (let i = 0; i < slotCount && i < photoPaths.length; i++) {
    out.push({ path: photoPaths[i], desc: descs[i] ?? "" });
  }
  return out;
}

const MatchSchema = z.object({
  matches: z.array(z.object({ slotIndex: z.number().int(), photoIndex: z.number().int() })),
});

// ai: 사진 설명과 각 자리의 캡션(주제 설명)을 claude로 매칭한다.
// ⚠️ 매칭 실패·누락분은 반드시 순서대로 채우는 폴백을 둔다(6-8 경고) — AI 매칭이
// 스키마는 통과했지만 인덱스가 이상하거나 일부 자리를 비워도 사진이 남으면 채운다.
export async function placeByAiMatch(
  photoPaths: string[],
  descs: string[],
  captions: string[]
): Promise<PlacedPhoto[]> {
  if (photoPaths.length === 0 || captions.length === 0) return [];

  const prompt = `
아래는 사진 설명 목록과, 블로그 글에서 사진이 필요한 자리(캡션) 목록입니다.
각 "자리"에 가장 잘 어울리는 "사진 번호"를 하나씩 배정하세요. 사진은 중복 배정하지 마세요.
전부 배정할 필요는 없습니다 — 어울리는 사진이 없으면 그 자리는 배열에서 생략하세요.

사진 목록:
${descs.map((d, i) => `${i}. ${d}`).join("\n")}

자리 목록:
${captions.map((c, i) => `${i}. ${c}`).join("\n")}

JSON 형식: {"matches": [{"slotIndex": 0, "photoIndex": 2}, ...]}
`.trim();

  const res = await runClaudeJson(prompt, MatchSchema);

  const usedPhotos = new Set<number>();
  const bySlot = new Map<number, number>();
  if (res.ok) {
    for (const m of res.data.matches) {
      const validIndex =
        m.slotIndex >= 0 &&
        m.slotIndex < captions.length &&
        m.photoIndex >= 0 &&
        m.photoIndex < photoPaths.length;
      if (validIndex && !usedPhotos.has(m.photoIndex) && !bySlot.has(m.slotIndex)) {
        bySlot.set(m.slotIndex, m.photoIndex);
        usedPhotos.add(m.photoIndex);
      }
    }
  }

  // 폴백: 매칭에서 빠진 자리는 남은 사진을 순서대로 채운다.
  const remainingPhotos = photoPaths.map((_, i) => i).filter((i) => !usedPhotos.has(i));
  let fallbackCursor = 0;
  const out: PlacedPhoto[] = [];
  for (let slot = 0; slot < captions.length; slot++) {
    let photoIndex = bySlot.get(slot);
    if (photoIndex === undefined) {
      if (fallbackCursor >= remainingPhotos.length) break;
      photoIndex = remainingPhotos[fallbackCursor++];
    }
    out.push({ path: photoPaths[photoIndex], desc: descs[photoIndex] ?? "" });
  }
  return out;
}
