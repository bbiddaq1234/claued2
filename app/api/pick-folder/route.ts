// POST /api/pick-folder — 네이티브 폴더 선택 대화상자 (7-14).
// 브라우저의 <input webkitdirectory>는 상대 경로만 줘서 Playwright 업로드에
// 쓸 수 없다 — 로컬 전용 앱이므로 백엔드에서 OS 네이티브 대화상자를 띄운다.
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
// ⚠️ 사용자가 대화상자를 방치하면 서버 요청이 영원히 안 끝난다 — 2분 타임아웃 필수.
const TIMEOUT_MS = 2 * 60_000;

function stripTrailingSep(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

export async function POST() {
  const platform = process.platform;

  if (platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "사진이 있는 폴더를 선택하세요")'],
        { timeout: TIMEOUT_MS }
      );
      const folder = stripTrailingSep(stdout.trim());
      if (!folder) return NextResponse.json({ ok: false, canceled: true });
      return NextResponse.json({ ok: true, path: folder });
    } catch (err: any) {
      // macOS: 취소하면 stderr에 "User canceled"가 온다 — 에러가 아니라 취소다.
      const stderr = String(err?.stderr ?? err?.message ?? "");
      if (/User canceled/i.test(stderr)) {
        return NextResponse.json({ ok: false, canceled: true });
      }
      return NextResponse.json({ ok: false, error: "폴더 선택창을 여는 데 실패했습니다." }, { status: 500 });
    }
  }

  if (platform === "win32") {
    // ⚠️ -STA 가 반드시 필요하다 — WinForms 대화상자는 STA 아파트먼트에서만 뜬다.
    // (11장 #3 — 윈도우 동작은 미검증)
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }";
    try {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-STA", "-Command", script], {
        timeout: TIMEOUT_MS,
      });
      const folder = stripTrailingSep(stdout.trim());
      // 윈도우는 취소 판정이 다르다: stdout이 빈 것으로 판정한다(맥은 stderr).
      if (!folder) return NextResponse.json({ ok: false, canceled: true });
      return NextResponse.json({ ok: true, path: folder });
    } catch {
      return NextResponse.json({ ok: false, error: "폴더 선택창을 여는 데 실패했습니다." }, { status: 500 });
    }
  }

  // 대화상자를 띄울 수 없는 플랫폼(리눅스 등) — 직접 입력 칸은 항상 제공해야 한다.
  return NextResponse.json({
    ok: false,
    unsupported: true,
    message: "이 환경에서는 폴더 선택창을 열 수 없습니다. 경로를 직접 입력해 주세요.",
  });
}
