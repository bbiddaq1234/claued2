// claude -p CLI 래퍼 — AI 호출의 심장 (6-1).
//
// ⚠️ 왜 @anthropic-ai/sdk 를 쓰지 않는가: SDK는 Anthropic API 키로 종량 과금된다.
// 이 앱은 사용자의 Claude 구독 요금제(정액)로 돌아가야 하므로, 로컬에 설치된 `claude` CLI를
// 자식 프로세스로 실행한다(2-1). 프롬프트는 반드시 stdin으로 전달한다 — argv로 넘기면
// 긴 한글에서 escaping이 깨진다.
import { spawn } from "node:child_process";
import type { z } from "zod";
import { CLAUDE_BIN } from "@/config";
import { getSettings } from "@/lib/settings";

export interface RunClaudeOpts {
  images?: string[];
  system?: string;
}

export type RunClaudeResult = { ok: true; text: string } | { ok: false; error: string };

// ── 동시성 세마포어 ──────────────────────────────────────────────
// claude 프로세스를 무제한으로 띄우면 머신이 죽는다. 동시성은 "호출 시점에"
// getSettings()에서 읽어, 설정 변경이 즉시 반영되게 한다.
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  const limit = getSettings().claudeConcurrency;
  if (active < limit) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

// ── 프로세스 실행 ────────────────────────────────────────────────
// ⚠️ 윈도우: npm 전역 바이너리는 claude.cmd 셸 심으로 깔리고 Node의 spawn은 .cmd를
// 직접 실행하지 못해 ENOENT로 죽는다(11장 #1). shell:true 로 우회한다 — 프롬프트를
// stdin으로 넘기므로 argv에는 "-p --output-format json" 뿐이라 셸 인용부호 문제가 없다.
const isWin = process.platform === "win32";
// CLAUDE_BIN을 사용자가 직접 지정하지 않았을 때만 .cmd/.exe 순서로 재시도한다.
const BIN_CANDIDATES: readonly string[] =
  isWin && CLAUDE_BIN === "claude" ? ["claude", "claude.cmd", "claude.exe"] : [CLAUDE_BIN];

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  spawnError: boolean;
}

function spawnOnce(
  bin: string,
  args: string[],
  stdin: string | null,
  timeoutMs: number | null
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { shell: isWin });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer =
      timeoutMs != null
        ? setTimeout(() => {
            timedOut = true;
            p.kill("SIGKILL");
          }, timeoutMs)
        : null;

    p.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
    p.stderr?.on("data", (d) => (stderr += d.toString("utf8")));

    p.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr || String(err), code: null, timedOut, spawnError: true });
    });

    p.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut, spawnError: false });
    });

    if (stdin != null) {
      p.stdin?.write(stdin, "utf8");
    }
    p.stdin?.end();
  });
}

// 후보 바이너리를 순서대로 시도한다. ENOENT류 spawn 에러일 때만 다음 후보로 넘어간다.
async function spawnWithFallback(
  args: string[],
  stdin: string | null,
  timeoutMs: number | null
): Promise<SpawnOutcome> {
  let last: SpawnOutcome | null = null;
  for (const bin of BIN_CANDIDATES) {
    const outcome = await spawnOnce(bin, args, stdin, timeoutMs);
    if (!outcome.spawnError) return outcome;
    last = outcome;
  }
  return last!;
}

export async function runClaude(prompt: string, opts: RunClaudeOpts = {}): Promise<RunClaudeResult> {
  await acquire();
  try {
    const settings = getSettings();
    let full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    // 이미지 첨부(비전) — 프롬프트 끝에 "@절대경로"를 공백 구분으로 붙인다.
    // 프로젝트 밖 절대경로도 동작한다(2-1 실증).
    if (opts.images?.length) {
      full += " " + opts.images.map((p) => `@${p}`).join(" ");
    }

    const outcome = await spawnWithFallback(
      ["-p", "--output-format", "json"],
      full,
      settings.claudeTimeoutSec * 1000
    );

    if (outcome.timedOut) {
      return {
        ok: false,
        error: `claude 응답이 ${settings.claudeTimeoutSec}초 안에 오지 않아 중단했습니다.`,
      };
    }
    if (outcome.spawnError) {
      return { ok: false, error: `claude 실행에 실패했습니다: ${outcome.stderr.trim()}` };
    }
    if (outcome.code !== 0 && !outcome.stdout.trim()) {
      return {
        ok: false,
        error: outcome.stderr.trim() || `claude 프로세스가 코드 ${outcome.code}로 종료됐습니다.`,
      };
    }

    // 정상 응답: { type:"result", result:"...", is_error:false, usage, modelUsage, ... }
    // 필드가 20개 넘게 더 있어도 정상이다 — .result 필드만 읽는다(2-1).
    try {
      const parsed = JSON.parse(outcome.stdout);
      if (parsed && typeof parsed === "object" && "result" in parsed) {
        if (parsed.is_error) {
          const msg =
            typeof parsed.result === "string" && parsed.result
              ? parsed.result
              : "claude가 오류를 반환했습니다.";
          return { ok: false, error: msg };
        }
        return { ok: true, text: String(parsed.result ?? "") };
      }
      return { ok: true, text: outcome.stdout };
    } catch {
      // JSON 파싱 실패 시 raw stdout을 그대로 텍스트로 반환(폴백).
      return { ok: true, text: outcome.stdout };
    }
  } finally {
    release();
  }
}

// ── 구조화 출력(JSON + Zod) ──────────────────────────────────────
const FORCE_JSON_SYSTEM =
  "반드시 유효한 JSON 만 출력하라. 설명/마크다운/코드펜스 없이 JSON 객체 또는 배열만 반환하라.";

// AI는 지시해도 앞뒤에 말을 붙인다. ① ```json 펜스를 먼저 찾고 ② 없으면 첫 { 또는 [
// 부터 마지막 짝 문자까지 잘라낸다.
export function extractJson(text: string): string | null {
  const fence = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();

  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const closeCh = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(closeCh);
  if (end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export type RunClaudeJsonResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function runClaudeJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: RunClaudeOpts & { retries?: number } = {}
): Promise<RunClaudeJsonResult<T>> {
  const retries = opts.retries ?? 2; // 기본 2회 재시도(총 3회 시도)
  const system = opts.system ? `${opts.system}\n\n${FORCE_JSON_SYSTEM}` : FORCE_JSON_SYSTEM;
  let lastError = "알 수 없는 오류";

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await runClaude(prompt, { images: opts.images, system });
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    const jsonText = extractJson(res.text);
    if (!jsonText) {
      lastError = "응답에서 JSON을 찾지 못했습니다.";
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      lastError = `JSON 파싱 실패: ${(e as Error).message}`;
      continue;
    }
    // Zod 검증 실패도 재시도 사유다.
    const result = schema.safeParse(parsed);
    if (result.success) {
      return { ok: true, data: result.data };
    }
    lastError = `스키마 검증 실패: ${result.error.issues.map((i) => i.message).join("; ")}`;
  }
  return { ok: false, error: lastError };
}

// ── 설치/로그인 확인 (대시보드 표시용) ─────────────────────────────
export interface ClaudeStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export async function checkClaude(): Promise<ClaudeStatus> {
  const outcome = await spawnWithFallback(["--version"], null, 15_000);
  if (outcome.timedOut) {
    return { installed: false, error: "claude --version 응답이 15초 안에 오지 않았습니다." };
  }
  if (outcome.spawnError) {
    return { installed: false, error: outcome.stderr.trim() || "claude 실행 파일을 찾을 수 없습니다." };
  }
  if (outcome.code === 0 && outcome.stdout.trim()) {
    return { installed: true, version: outcome.stdout.trim() };
  }
  return { installed: false, error: outcome.stderr.trim() || `종료 코드 ${outcome.code}` };
}
