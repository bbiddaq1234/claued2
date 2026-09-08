// 런타임 설정 (6-11). config.ts 의 DEFAULT_SETTINGS 는 "최초 시드"일 뿐이고,
// 이후에는 이 파일을 거쳐 DB(settings 테이블)에 저장된 값이 항상 우선한다.
import { getDb } from "@/lib/db";
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, type Settings } from "@/config";

type Key = keyof Settings;

const KEYS = Object.keys(DEFAULT_SETTINGS) as Key[];

function clamp(key: Key, value: unknown): unknown {
  switch (key) {
    case "dryRun":
    case "killSwitch":
    case "showBrowser":
      return Boolean(value);
    case "visibility": {
      const allowed = SETTINGS_LIMITS.visibility as readonly string[];
      return allowed.includes(String(value)) ? value : DEFAULT_SETTINGS.visibility;
    }
    case "dailyPublishLimit":
    case "minPublishIntervalMin":
    case "scrapeTopN":
    case "imageCandidates":
    case "cfImageSteps":
    case "claudeTimeoutSec":
    case "claudeConcurrency": {
      const lim = SETTINGS_LIMITS[key] as { min: number; max: number };
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) return DEFAULT_SETTINGS[key];
      return Math.min(lim.max, Math.max(lim.min, n));
    }
    default:
      return value;
  }
}

// 호출 시점에 매번 DB에서 읽는다 — 설정 변경이 실행 중인 잡에도 즉시 반영되도록
// (특히 claudeConcurrency는 6-1 요구사항: "동시성은 호출 시점에 읽어라").
export function getSettings(): Settings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_SETTINGS };
  for (const key of KEYS) {
    if (stored.has(key)) {
      try {
        (out as any)[key] = clamp(key, JSON.parse(stored.get(key)!));
      } catch {
        // 저장된 값이 깨졌으면 기본값을 유지한다.
      }
    }
  }
  return out;
}

export function isKnownKey(key: string): key is Key {
  return (KEYS as string[]).includes(key);
}

// 알 수 없는 키는 여기서 걸러지지 않는다 — API 라우트(6-12)가 400으로 거절한다.
// 여기서는 클램프까지만 책임진다: "UI에서 막지 말고 서버에서 보정" (6-11).
export function setSettings(partial: Partial<Record<string, unknown>>): Settings {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  );
  const tx = db.transaction((entries: Array<[string, unknown]>) => {
    for (const [key, raw] of entries) {
      if (!isKnownKey(key)) continue;
      const clamped = clamp(key, raw);
      stmt.run(key, JSON.stringify(clamped));
    }
  });
  tx(Object.entries(partial));
  return getSettings();
}

export function resetSettings(): Settings {
  const db = getDb();
  db.prepare("DELETE FROM settings").run();
  return getSettings();
}

export { SETTINGS_LIMITS as LIMITS };
