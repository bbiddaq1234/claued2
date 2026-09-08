// data 디렉토리 보장 + 절대경로. 이 앱의 모든 산출물은 DATA_DIR 아래에만 쓴다 (2-2 완전 로컬).
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/config";

function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function dataRoot(): string {
  return ensureDir(DATA_DIR);
}

export function dbFile(): string {
  return path.join(ensureDir(DATA_DIR), "app.db");
}

export function sessionDir(): string {
  return ensureDir(path.join(DATA_DIR, "session"));
}

export function sessionFile(): string {
  return path.join(sessionDir(), "naver-storage-state.json");
}

export function imagesDir(jobId?: string | number): string {
  const base = path.join(DATA_DIR, "images");
  return ensureDir(jobId === undefined ? base : path.join(base, String(jobId)));
}

export function screenshotsDir(jobId?: string | number): string {
  const base = path.join(DATA_DIR, "screenshots");
  return ensureDir(jobId === undefined ? base : path.join(base, String(jobId)));
}

export function localPhotoCacheDir(): string {
  return ensureDir(path.join(DATA_DIR, "local-photos-cache"));
}

// /api/file 이 쓰는 경로 정규화(7-23). macOS process.cwd() 는 한글을 NFD로 주고
// 브라우저가 보내는 URL 파라미터는 NFC라서, 정규화 없이 startsWith 비교하면
// 한글 경로에서 전부 403이 난다. 윈도우는 대소문자도 다른 경로로 취급하므로 소문자로 맞춘다.
export function normalizeForCompare(p: string): string {
  const n = path.resolve(p).normalize("NFC");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

// path가 dataRoot() 내부인지 검사(경로 탈출 방지). 정규화까지 마친 뒤 비교한다.
export function isInsideDataRoot(p: string): boolean {
  const root = normalizeForCompare(dataRoot());
  const target = normalizeForCompare(p);
  return target === root || target.startsWith(root + path.sep);
}
