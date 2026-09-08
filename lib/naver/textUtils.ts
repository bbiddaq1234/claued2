// 타이핑 직전 텍스트 방어 (7-8 마크다운, 7-25 VS16 이모지).
import type { Page } from "playwright";

// ⚠️ 7-8: 스마트에디터는 입력 중 마크다운을 자동으로 서식으로 바꾼다.
// AI에게 마크다운을 쓰지 말라고 지시하는 것만으로는 부족하다 — 타이핑 직전에
// 코드로 한 번 더 무력화한다. 한국어 구어체의 물결표(~)가 특히 위험하다.
export function neutralizeMarkdown(text: string): string {
  return text
    .replace(/~+/g, "～") // 전각 물결표로(어감은 보존)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "");
}

// ⚠️ 7-25: VS16(변이 선택자, 코드포인트 0xFE0F)가 붙은 이모지(경고·하트·체크·해·숫자
// 키캡 등)를 keyboard.type으로 치면 base 문자가 하나 더 남아 화면에 두 번 찍힌
// 것처럼 보인다. keyboard.insertText로 문단 전체를 넣으면 이모지 하나만 남고
// 나머지 글이 통째로 사라진다(실측 — 절대 이렇게 고치지 말 것). 정답은 VS16
// 클러스터만 잘라서 그 조각만 insertText, 나머지는 그대로 type이다.
//
// 정규식 리터럴에 변이 선택자를 직접 박아두면 소스에 눈에 안 보이는 문자가 섞여
// diff/리뷰가 어려워지므로, 코드포인트로 문자열을 만들어 RegExp를 구성한다.
const VS16 = String.fromCodePoint(0xfe0f);
const KEYCAP = String.fromCodePoint(0x20e3);
const HAS_VS16 = new RegExp(VS16);
const VS16_CLUSTER = new RegExp("([\\s\\S]" + VS16 + KEYCAP + "?)");

export async function typeSafely(page: Page, text: string, delay = 7): Promise<void> {
  const parts = text.split(VS16_CLUSTER);
  for (const part of parts) {
    if (!part) continue;
    if (HAS_VS16.test(part)) {
      await page.keyboard.insertText(part);
    } else {
      await page.keyboard.type(part, { delay });
    }
  }
}
