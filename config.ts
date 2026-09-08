// 전역 기본값. 여기 값은 "최초 1회" 기본값일 뿐이다.
// 실행 중 설정 변경은 전부 lib/settings.ts 를 거쳐 DB(settings 테이블)에 저장되고,
// 그 이후부터는 DB 값이 이 파일보다 우선한다 (6-11).
import path from "node:path";

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function envBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

// ./data 를 루트로 완전 로컬 (2-2). DATA_DIR 환경변수로만 오버라이드 가능.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");

// 개발 서버 포트. 3000은 다른 프로젝트와 부딪히므로 4123 고정.
export const PORT = 4123;

// claude -p CLI 바이너리. 윈도우에서 spawn 이 ENOENT 로 죽으면(11장 #1)
// 사용자가 이 값을 claude.cmd 전체 경로로 지정할 수 있게 한다.
export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// Cloudflare Workers AI (선택). 없어도 앱은 전부 돌아간다 — AI 이미지 생성만 못 쓴다.
export const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
export const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";

// lib/settings.ts 가 DB에 아무 값도 없을 때 시드로 쓰는 "최초 기본값" (6-11 표).
export const DEFAULT_SETTINGS = {
  dryRun: true, // ⚠️ 기본 켜짐. 안전장치(2-5) — 절대 false로 하드코드하지 말 것.
  killSwitch: false,
  visibility: "private" as const, // ⚠️ 반드시 private. 네이버 발행 레이어 기본값은 전체공개(7-19, 12장).
  dailyPublishLimit: envInt("DAILY_PUBLISH_LIMIT", 3),
  minPublishIntervalMin: envInt("MIN_PUBLISH_INTERVAL_MIN", 30),
  scrapeTopN: envInt("SCRAPE_TOP_N", 8),
  imageCandidates: envInt("IMAGE_CANDIDATES", 10),
  cfImageSteps: envInt("CF_IMAGE_STEPS", 6),
  showBrowser: envBool("SHOW_BROWSER", false),
  claudeTimeoutSec: envInt("CLAUDE_TIMEOUT_SEC", 180),
  claudeConcurrency: envInt("CLAUDE_CONCURRENCY", 2),
};

export type Settings = typeof DEFAULT_SETTINGS;

// UI/서버가 같은 규칙을 쓰도록 범위를 한 곳에 (6-11).
export const SETTINGS_LIMITS = {
  visibility: ["public", "neighbor", "both", "private"] as const,
  dailyPublishLimit: { min: 1, max: 50 },
  minPublishIntervalMin: { min: 0, max: 720 },
  scrapeTopN: { min: 3, max: 30 },
  imageCandidates: { min: 3, max: 20 },
  cfImageSteps: { min: 1, max: 8 },
  claudeTimeoutSec: { min: 30, max: 900 },
  claudeConcurrency: { min: 1, max: 6 },
};
