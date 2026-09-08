"use client";

// 조종석 대시보드 (6-13). "내 블로그에 대신 글을 올리는 기계의 조종석" —
// 색은 장식이 아니라 신호로만 쓴다.
import { useCallback, useEffect, useRef, useState } from "react";
import SettingsDrawer, { type Limits, type Settings } from "./SettingsDrawer";

type Mode = "auto" | "experience" | "branding";
type PhotoSource = "none" | "local" | "ai" | "crawl";

interface StatusResp {
  claude: { installed: boolean; version?: string; error?: string };
  naver: { valid: boolean; reason?: string; blogId?: string };
  cloudflareConfigured: boolean;
  settings: Settings;
  limits: Limits;
}

interface UsageResp {
  neurons: {
    usedToday: number;
    dailyFree: number;
    source: "measured" | "estimated";
    perImage: number;
    imagesPerDayAtCurrentSteps: number;
    steps: number;
  };
  publish: { today: number; dailyLimit: number };
}

interface JobRow {
  id: number;
  keyword: string;
  status: string;
  stage: string;
  mode: string;
  created_at: string;
}

const ACTIVE_STATUSES = new Set(["pending", "scraping", "writing", "imaging", "publishing"]);

async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export default function Page() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  const refreshStatus = useCallback(async (refresh = false) => {
    const { data } = await getJson<StatusResp>(`/api/status${refresh ? "?refresh=1" : ""}`);
    setStatus(data);
  }, []);
  const refreshUsage = useCallback(async () => {
    const { data } = await getJson<UsageResp>("/api/usage");
    setUsage(data);
  }, []);
  const refreshJobs = useCallback(async () => {
    const { data } = await getJson<{ jobs: JobRow[] }>("/api/jobs");
    setJobs(data.jobs ?? []);
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshUsage();
    refreshJobs();
  }, [refreshStatus, refreshUsage, refreshJobs]);

  // 진행 중인 잡이 있으면 목록을 3초마다 갱신해 상태 변화를 보여준다.
  useEffect(() => {
    const hasActive = jobs.some((j) => ACTIVE_STATUSES.has(j.status));
    if (!hasActive) return;
    const t = setInterval(refreshJobs, 3000);
    return () => clearInterval(t);
  }, [jobs, refreshJobs]);

  async function handleLogin() {
    setLoginBusy(true);
    try {
      const { ok, data } = await getJson<{ ok: boolean; error?: string }>("/api/naver/login", { method: "POST" });
      if (!ok) alert(`로그인이 완료되지 않았습니다: ${(data as any).error ?? "알 수 없는 이유"}`);
      await refreshStatus(true);
    } finally {
      setLoginBusy(false);
    }
  }
  async function handleLogout() {
    await getJson("/api/naver/logout", { method: "POST" });
    await refreshStatus(true);
  }

  async function handleSettingsChange(patch: Partial<Settings> | { reset: true }) {
    const { data } = await getJson<{ settings: Settings; limits: Limits }>("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setStatus((s) => (s ? { ...s, settings: data.settings } : s));
    refreshUsage();
  }

  function onJobCreated(jobId: number) {
    refreshJobs();
    setSelectedJobId(jobId);
  }

  const settings = status?.settings ?? null;

  return (
    <div className="app">
      <StatusRail
        settings={settings}
        onOpenSettings={() => setSettingsOpen(true)}
        claudeOk={!!status?.claude.installed}
        naverOk={!!status?.naver.valid}
        cfOk={!!status?.cloudflareConfigured}
      />

      <main className="main">
        <MetersRow usage={usage} settings={settings} />

        <section className="naver-box">
          <div>
            <strong>네이버 로그인</strong>
            <p className="dim">
              {status?.naver.valid
                ? `연결됨 (블로그: ${status.naver.blogId ?? "확인됨"})`
                : status?.naver.reason ?? "확인 중..."}
            </p>
          </div>
          {status?.naver.valid ? (
            <button className="btn" onClick={handleLogout}>
              로그아웃
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleLogin} disabled={loginBusy}>
              {loginBusy ? "로그인 창을 여는 중..." : "네이버 로그인"}
            </button>
          )}
        </section>

        <div className="columns">
          <WriteForm status={status} onCreated={onJobCreated} />
          <RecentJobs jobs={jobs} selectedId={selectedJobId} onSelect={setSelectedJobId} />
        </div>

        {selectedJobId != null && <JobDetail jobId={selectedJobId} onJobFinished={refreshJobs} />}
      </main>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        limits={status?.limits ?? null}
        onClose={() => setSettingsOpen(false)}
        onChange={handleSettingsChange}
      />
    </div>
  );
}

// ── 상태 레일 ────────────────────────────────────────────────────
function StatusRail({
  settings,
  onOpenSettings,
  claudeOk,
  naverOk,
  cfOk,
}: {
  settings: Settings | null;
  onOpenSettings: () => void;
  claudeOk: boolean;
  naverOk: boolean;
  cfOk: boolean;
}) {
  let tone: "armed" | "safe" | "live" = "safe";
  let text = "설정을 불러오는 중입니다...";
  if (settings) {
    if (settings.killSwitch) {
      tone = "armed";
      text = "전체 중단 / 어떤 작업도 발행되지 않습니다";
    } else if (settings.dryRun) {
      tone = "safe";
      text = "연습 모드 / 발행하지 않고 완성 화면만 저장합니다";
    } else {
      tone = "armed";
      text = "실제 발행 / 완성되는 글이 블로그에 그대로 올라갑니다";
    }
  }

  return (
    <header className={`rail rail-${tone}`}>
      <span className="rail-text">{text}</span>
      <div className="rail-right">
        <Dot label="Claude" ok={claudeOk} />
        <Dot label="네이버" ok={naverOk} />
        <Dot label="이미지 생성" ok={cfOk} />
        <button className="btn-icon" onClick={onOpenSettings} aria-label="설정 열기">
          ⚙️
        </button>
      </div>
    </header>
  );
}

function Dot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="dot-wrap" title={label}>
      <span className={`dot ${ok ? "dot-ok" : "dot-off"}`} />
      {label}
    </span>
  );
}

// ── 계량기 ───────────────────────────────────────────────────────
function MetersRow({ usage, settings }: { usage: UsageResp | null; settings: Settings | null }) {
  if (!usage || !settings) return null;

  const publishPct = Math.min(100, (usage.publish.today / Math.max(1, usage.publish.dailyLimit)) * 100);
  const neuronPct = Math.min(100, (usage.neurons.usedToday / Math.max(1, usage.neurons.dailyFree)) * 100);

  return (
    <div className="meters">
      <Meter
        title={`오늘 발행 ${usage.publish.today} / ${usage.publish.dailyLimit}편`}
        subtitle={
          publishPct >= 90
            ? "한도에 다 왔어요 — 설정에서 늘릴 수 있습니다."
            : `발행 간격 ${settings.minPublishIntervalMin}분`
        }
        pct={publishPct}
      />
      <Meter
        title={`이미지 생성량 ${usage.neurons.usedToday} / ${usage.neurons.dailyFree.toLocaleString()} 뉴런`}
        subtitle={`${usage.neurons.source === "measured" ? "실측" : "추정"} · 장당 ${usage.neurons.perImage} 뉴런`}
        pct={neuronPct}
      />
    </div>
  );
}

function Meter({ title, subtitle, pct }: { title: string; subtitle: string; pct: number }) {
  const tone = pct >= 90 ? "armed" : pct >= 70 ? "live" : "safe";
  return (
    <div className="meter-card">
      <div className="meter-title">{title}</div>
      <div className="meter-bar">
        <div className={`meter-fill meter-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-sub">{subtitle}</div>
    </div>
  );
}

// ── 작성 화면 ────────────────────────────────────────────────────
const MODE_CARDS: Array<{ key: Mode; title: string; desc: string }> = [
  { key: "auto", title: "자동 발굴", desc: "관심 키워드만 넣으면 글감부터 골라 씁니다" },
  { key: "experience", title: "체험단", desc: "방문/사용 후기를 1인칭으로 씁니다" },
  { key: "branding", title: "브랜딩·전문성", desc: "전문가 포지셔닝 글을 씁니다" },
];

function WriteForm({ status, onCreated }: { status: StatusResp | null; onCreated: (id: number) => void }) {
  const [mode, setMode] = useState<Mode>("auto");
  const [keyword, setKeyword] = useState("");
  const [topic, setTopic] = useState("");
  const [keyContent, setKeyContent] = useState("");
  const [photoSource, setPhotoSource] = useState<PhotoSource>("none");
  const [imageStyle, setImageStyle] = useState<"photo" | "illust">("photo");
  const [localFolder, setLocalFolder] = useState("");
  const [placementMode, setPlacementMode] = useState<"order" | "ai">("order");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 자동 발굴에는 '내 사진'이 없다 — 주제를 미리 모르기 때문이다(1장).
    if (mode === "auto" && photoSource === "local") setPhotoSource("none");
  }, [mode, photoSource]);

  const photoOptions: Array<{ key: PhotoSource; label: string }> =
    mode === "auto"
      ? [
          { key: "none", label: "없음" },
          { key: "crawl", label: "검색 크롤링" },
          { key: "ai", label: "AI 생성" },
        ]
      : [
          { key: "none", label: "없음" },
          { key: "local", label: "내 사진" },
          { key: "crawl", label: "검색 크롤링" },
          { key: "ai", label: "AI 생성" },
        ];

  const cfBlocked = photoSource === "ai" && status && !status.cloudflareConfigured;

  async function pickFolder() {
    const { data } = await getJson<{ ok: boolean; path?: string; unsupported?: boolean; message?: string }>(
      "/api/pick-folder",
      { method: "POST" }
    );
    if (data.ok && data.path) setLocalFolder(data.path);
    else if (data.message) alert(data.message);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { mode, photoSource };
      if (mode === "auto") body.keyword = keyword;
      else {
        body.topic = topic;
        body.keyContent = keyContent;
      }
      if (photoSource === "ai") body.imageStyle = imageStyle;
      if (photoSource === "local") {
        body.localFolder = localFolder;
        body.placementMode = placementMode;
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409) {
        setError("이미 진행 중인 작업이 있어요. 끝나면 다시 시도해 주세요.");
        return;
      }
      if (!res.ok) {
        const first = data.issues?.[0]?.message;
        setError(first ?? data.error ?? "만드는 데 실패했습니다.");
        return;
      }
      onCreated(data.id);
    } catch {
      setError("서버와 통신하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const dryRun = status?.settings.dryRun ?? true;
  const killSwitch = status?.settings.killSwitch ?? false;

  return (
    <section className="card write-form">
      <h2>새로 쓰기</h2>
      <div className="mode-cards">
        {MODE_CARDS.map((m) => (
          <button
            key={m.key}
            className={`mode-card ${mode === m.key ? "mode-card-selected" : ""}`}
            aria-pressed={mode === m.key}
            onClick={() => setMode(m.key)}
          >
            <strong>{m.title}</strong>
            <span>{m.desc}</span>
          </button>
        ))}
      </div>

      {mode === "auto" ? (
        <label className="field">
          <span>관심 키워드</span>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 제주도 여행" />
        </label>
      ) : (
        <>
          <label className="field">
            <span>주제</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 동네 조용한 북카페" />
          </label>
          <label className="field">
            <span>핵심 내용</span>
            <textarea
              value={keyContent}
              onChange={(e) => setKeyContent(e.target.value)}
              rows={4}
              placeholder="이름/위치/가격/특징처럼, 글에 꼭 들어가야 할 사실을 적어주세요"
            />
          </label>
        </>
      )}

      <label className="field">
        <span>사진</span>
        <select value={photoSource} onChange={(e) => setPhotoSource(e.target.value as PhotoSource)}>
          {photoOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {photoSource === "ai" && (
        <label className="field">
          <span>그림체</span>
          <select value={imageStyle} onChange={(e) => setImageStyle(e.target.value as "photo" | "illust")}>
            <option value="photo">사진처럼</option>
            <option value="illust">일러스트처럼</option>
          </select>
          {cfBlocked && (
            <p className="badge badge-warn">
              AI 사진 생성 열쇠가 없습니다. 설정에서 열쇠를 넣거나 다른 사진 소스를 골라주세요.
            </p>
          )}
        </label>
      )}

      {photoSource === "local" && (
        <>
          <label className="field">
            <span>사진 폴더</span>
            <div className="field-row">
              <input
                value={localFolder}
                onChange={(e) => setLocalFolder(e.target.value)}
                placeholder="폴더 경로를 입력하거나 아래 버튼으로 고르세요"
              />
              <button type="button" className="btn" onClick={pickFolder}>
                폴더 선택
              </button>
            </div>
          </label>
          <label className="field">
            <span>사진 배치</span>
            <select value={placementMode} onChange={(e) => setPlacementMode(e.target.value as "order" | "ai")}>
              <option value="order">찍은 순서대로</option>
              <option value="ai">AI가 어울리는 자리에</option>
            </select>
          </label>
        </>
      )}

      {error && <p className="badge badge-warn">{error}</p>}

      <button
        className="btn btn-primary btn-block"
        onClick={submit}
        disabled={busy || killSwitch || !!cfBlocked}
        title={killSwitch ? "전체 중단이 켜져 있어 실행할 수 없습니다." : undefined}
      >
        {killSwitch ? "전체 중단 중" : busy ? "만드는 중..." : dryRun ? "연습으로 만들기" : "글 만들고 발행하기"}
      </button>
    </section>
  );
}

// ── 최근 작업 목록 ───────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  pending: "대기 중",
  scraping: "수집 중",
  writing: "쓰는 중",
  imaging: "사진 준비 중",
  publishing: "발행하는 중",
  done: "완료",
  failed: "실패",
  canceled: "취소됨",
};

function RecentJobs({
  jobs,
  selectedId,
  onSelect,
}: {
  jobs: JobRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <section className="card jobs-list">
      <h2>최근 작업</h2>
      {jobs.length === 0 && <p className="dim">아직 만든 글이 없습니다.</p>}
      <ul>
        {jobs.map((j) => (
          <li key={j.id}>
            <button
              className={`job-row ${selectedId === j.id ? "job-row-selected" : ""}`}
              onClick={() => onSelect(j.id)}
            >
              <span className="job-keyword">{j.keyword}</span>
              <span className={`job-status job-status-${j.status}`}>
                {STATUS_LABEL[j.status] ?? j.status}
                {ACTIVE_STATUSES.has(j.status) && j.stage ? ` · ${j.stage}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── 진행/결과 ────────────────────────────────────────────────────
interface LogLine {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
}

interface JobDetailResp {
  job: { id: number; status: string; stage: string; keyword: string };
  drafts: Array<{ id: number; title: string; body_json: any[] }>;
  images: Array<{ id: number; section_index: number; local_path: string | null; verdict_ok: number }>;
  posts: Array<{ id: number; status: string; blog_url: string | null; screenshot: string | null; note: string }>;
}

function JobDetail({ jobId, onJobFinished }: { jobId: number; onJobFinished: () => void }) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [detail, setDetail] = useState<JobDetailResp | null>(null);
  const [finished, setFinished] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const loadDetail = useCallback(async () => {
    const { data } = await getJson<JobDetailResp>(`/api/jobs/${jobId}`);
    setDetail(data);
  }, [jobId]);

  useEffect(() => {
    setLogs([]);
    setFinished(false);
    loadDetail();

    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const row = JSON.parse(ev.data);
      setLogs((prev) => [...prev, row]);
    };
    es.addEventListener("end", () => {
      setFinished(true);
      es.close();
      loadDetail();
      onJobFinished();
    });
    es.onerror = () => {
      // 연결이 끊기면 조용히 닫는다 — 사용자를 붙잡아두지 않는다.
      es.close();
    };
    return () => es.close();
  }, [jobId, loadDetail, onJobFinished]);

  const draft = detail?.drafts?.[detail.drafts.length - 1];
  const post = detail?.posts?.[detail.posts.length - 1];

  return (
    <section className="card job-detail">
      <h2>
        {detail?.job.keyword ?? `작업 #${jobId}`}
        {!finished && <span className="dim"> · {STATUS_LABEL[detail?.job.status ?? ""] ?? "진행 중"}</span>}
      </h2>

      <div className="log-box" role="log">
        {logs.map((l) => (
          <p key={l.id} className={`log-line log-${l.level}`}>
            {l.message}
          </p>
        ))}
        {!finished && logs.length === 0 && <p className="dim">시작하는 중입니다...</p>}
      </div>

      {finished && post && (
        <div className="result-box">
          {post.status === "published" && post.blog_url && (
            <p>
              ✅ 발행되었습니다 —{" "}
              <a href={post.blog_url} target="_blank" rel="noreferrer">
                올라간 글 열어보기
              </a>
            </p>
          )}
          {post.status === "dry_run" && <p className="badge badge-safe">연습 모드 — 실제로 올라가지 않았습니다.</p>}
          {(post.status === "failed" || post.status === "blocked") && (
            <p className="badge badge-warn">{post.note}</p>
          )}
          {post.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="preview-shot"
              src={`/api/file?path=${encodeURIComponent(post.screenshot)}`}
              alt="완성된 글 미리보기 스크린샷"
            />
          )}
        </div>
      )}

      {finished && draft && (
        <div className="draft-preview">
          <h3>{draft.title}</h3>
          {draft.body_json.map((section: any, i: number) => (
            <SectionView key={i} section={section} image={detail?.images.find((img) => img.section_index === i)} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionView({ section, image }: { section: any; image?: { local_path: string | null; verdict_ok: number } }) {
  switch (section.type) {
    case "heading":
      return <h3>{section.text}</h3>;
    case "quote":
      return <blockquote>{section.text}</blockquote>;
    case "divider":
      return <hr />;
    case "paragraph":
      return <p>{renderHighlighted(section.text, section.highlight)}</p>;
    case "image":
      return image?.local_path && image.verdict_ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="draft-image" src={`/api/file?path=${encodeURIComponent(image.local_path)}`} alt={section.caption ?? ""} />
      ) : (
        <p className="dim">(이 자리에 쓸 사진을 구하지 못했습니다)</p>
      );
    default:
      return null;
  }
}

function renderHighlighted(text: string, highlight?: string) {
  if (!highlight) return text;
  const idx = text.indexOf(highlight);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{highlight}</mark>
      {text.slice(idx + highlight.length)}
    </>
  );
}
