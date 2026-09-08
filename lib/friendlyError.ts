// 에러 메시지를 사용자가 이해할 수 있는 한국어 문장으로 바꾼다(8-6 "에러가 났을 때").
// 원인을 숨기지는 않되(8-2), 원문 스택 대신 "무슨 뜻인지"를 보여준다 — 화면(작업
// 로그)에는 summary만 남기고, 원문(detail)은 서버 콘솔에만 남겨 개발자가 필요할 때
// 볼 수 있게 한다.
const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

interface Rule {
  test: RegExp;
  summary: string;
}

const RULES: Rule[] = [
  {
    test: /net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|dns/i,
    summary: "인터넷 연결에 문제가 있어 접속하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
  },
  {
    test: /session limit/i,
    summary: "오늘 AI 사용량을 다 썼습니다. 잠시 후(보통 몇 시간 뒤) 다시 시도할 수 있습니다.",
  },
  {
    test: /ENOENT/i,
    summary: "AI를 실행하는 프로그램(claude)을 찾지 못했습니다. 설치가 되어 있는지 확인해 주세요.",
  },
  {
    test: /Executable doesn'?t exist|please run.*playwright install/i,
    summary: "브라우저 구성 요소가 아직 준비되지 않았습니다. 잠시 후 자동으로 설치를 시도합니다.",
  },
  {
    test: /timeout/i,
    summary: "응답이 너무 오래 걸려 중단했습니다.",
  },
];

export interface FriendlyError {
  summary: string;
  detail: string;
}

export function friendlyError(err: unknown): FriendlyError {
  const raw = stripAnsi(err instanceof Error ? err.message : String(err)).trim();
  const firstLine = raw.split("\n")[0].slice(0, 300);
  const rule = RULES.find((r) => r.test.test(raw));
  return { summary: rule?.summary ?? "예상하지 못한 문제로 중단됐습니다.", detail: firstLine };
}
