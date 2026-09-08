// SQLite 싱글톤 + 스키마 + 마이그레이션 (5장).
import Database from "better-sqlite3";
import { dbFile } from "@/lib/paths";

// ⚠️ Next.js dev의 HMR은 이 모듈을 여러 번 평가한다. globalThis에 캐싱하지 않으면
// 매 저장마다 새 커넥션이 열려 파일 핸들이 계속 쌓인다 (7-17).
const g = globalThis as unknown as { __blogDb?: Database.Database };

function open(): Database.Database {
  if (g.__blogDb) return g.__blogDb;
  const db = new Database(dbFile());
  // SSE 폴링(읽기)과 잡 실행(쓰기)이 동시에 일어나므로 WAL이 필요하다.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  g.__blogDb = db;
  return db;
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

// 기존 DB를 날리지 않기 위해 CREATE TABLE IF NOT EXISTS + 컬럼 존재 확인 후 ALTER TABLE 방식을 쓴다.
function ensureColumn(db: Database.Database, table: string, col: string, decl: string) {
  const cols = tableColumns(db, table);
  if (!cols.has(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending', -- pending|scraping|writing|imaging|publishing|done|failed|canceled
      stage      TEXT NOT NULL DEFAULT '',
      auto       INTEGER NOT NULL DEFAULT 1,       -- 1=자동 발굴, 0=유형별(체험단/브랜딩)
      mode       TEXT NOT NULL DEFAULT 'auto',     -- auto|experience|branding
      inputs     TEXT NOT NULL DEFAULT '{}',       -- JSON: 사용자 입력 원본(주제/핵심내용/사진소스 등)
      error      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id),
      type       TEXT NOT NULL, -- news|blog
      title      TEXT NOT NULL,
      summary    TEXT NOT NULL DEFAULT '',
      url        TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id),
      title      TEXT NOT NULL,
      angle      TEXT NOT NULL DEFAULT '',
      rationale  TEXT NOT NULL DEFAULT '',
      chosen     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id),
      idea_id    INTEGER REFERENCES ideas(id),
      title      TEXT NOT NULL,
      body_json  TEXT NOT NULL, -- 섹션 배열 JSON
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         INTEGER NOT NULL REFERENCES jobs(id),
      draft_id       INTEGER REFERENCES drafts(id),
      query          TEXT NOT NULL DEFAULT '',
      src_url        TEXT,
      local_path     TEXT,
      source_site    TEXT NOT NULL DEFAULT 'local', -- naver|google|ai|local
      verdict_ok     INTEGER NOT NULL DEFAULT 0,
      verdict_reason TEXT NOT NULL DEFAULT '',
      section_index  INTEGER NOT NULL DEFAULT -1,
      gen_prompt     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id       INTEGER NOT NULL REFERENCES jobs(id),
      draft_id     INTEGER REFERENCES drafts(id),
      status       TEXT NOT NULL DEFAULT 'pending', -- pending|publishing|published|dry_run|failed|blocked
      blog_url     TEXT,
      screenshot   TEXT,
      note         TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id),
      level      TEXT NOT NULL DEFAULT 'info', -- info|warn|error
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sources_job ON sources(job_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_job ON ideas(job_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_job ON drafts(job_id);
    CREATE INDEX IF NOT EXISTS idx_images_job ON images(job_id);
    CREATE INDEX IF NOT EXISTS idx_posts_job ON posts(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id, id);
  `);

  // 스키마 변경 시 여기에 ensureColumn 을 추가한다 (컬럼 존재 확인 후 ALTER).
  ensureColumn(db, "jobs", "error", "TEXT");
}

export function getDb(): Database.Database {
  return open();
}
