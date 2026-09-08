import { getSettings } from "@/lib/settings";

// 뼈대 단계 확인용 임시 화면. 진짜 대시보드(상태 레일·계량기·작성 화면)는
// 11번 작업(UI)에서 이 파일을 클라이언트 컴포넌트로 교체한다.
export default function Page() {
  const settings = getSettings();
  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>네이버 블로그 자동 발행 — 뼈대 확인</h1>
      <p style={{ color: "var(--text-dim)" }}>
        이 화면은 아직 조종석이 아니라, 설정값이 DB에서 제대로 읽히는지 보는 임시 화면입니다.
      </p>
      <pre
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          overflowX: "auto",
        }}
      >
        {JSON.stringify(settings, null, 2)}
      </pre>
    </main>
  );
}
