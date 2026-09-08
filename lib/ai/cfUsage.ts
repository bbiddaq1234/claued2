// 사용량 조회(실측/추정) (6-7, 7-12).
import { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } from "@/config";
import { getDb } from "@/lib/db";
import { neuronsPerImage } from "@/lib/ai/neurons";

export interface UsageResult {
  neuronsToday: number;
  source: "measured" | "estimated";
}

// GraphQL aiInferenceAdaptiveGroups로 실측 조회. API 토큰에 "Account Analytics: Read"
// 권한이 없으면 401이 아니라 GraphQL errors 배열로 "not authorized"가 온다(7-12) —
// 이 경우 null을 반환해 추정치로 폴백하게 한다.
async function fetchMeasuredUsage(): Promise<number | null> {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) return null;

  const today = new Date().toISOString().slice(0, 10);
  const query = `
    query {
      viewer {
        accounts(filter: { accountTag: "${CLOUDFLARE_ACCOUNT_ID}" }) {
          aiInferenceAdaptiveGroups(
            limit: 1000
            filter: { date_geq: "${today}" }
          ) {
            sum { requests neurons }
          }
        }
      }
    }`;

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const json: any = await res.json();
    if (!res.ok || json?.errors?.length) return null;
    const groups: Array<{ sum?: { neurons?: number } }> =
      json?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
    return groups.reduce((sum, g) => sum + (g.sum?.neurons ?? 0), 0);
  } catch {
    return null;
  }
}

// 실측이 안 될 때, 자체 생성 로그(images 테이블)로 근사치를 계산한다.
// ⚠️ 하루 집계는 로컬 날짜 기준이어야 한다 — UTC로 비교하면 새벽 시간대 기록이
// 어제로 새어나간다(7-22). 양쪽 다 'localtime'으로 변환해서 비교한다.
function estimateFromLogs(steps: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM images
       WHERE source_site = 'ai' AND date(created_at, 'localtime') = date('now', 'localtime')`
    )
    .get() as { cnt: number };
  return row.cnt * neuronsPerImage(steps);
}

export async function getUsage(steps: number): Promise<UsageResult> {
  const measured = await fetchMeasuredUsage();
  if (measured != null) {
    return { neuronsToday: measured, source: "measured" };
  }
  return { neuronsToday: estimateFromLogs(steps), source: "estimated" };
}

// 오늘 발행 수 — 하루 발행 한도 계량기에 쓴다. 역시 로컬 날짜 기준(7-22).
export function publishedToday(): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM posts
       WHERE status = 'published' AND date(published_at, 'localtime') = date('now', 'localtime')`
    )
    .get() as { cnt: number };
  return row.cnt;
}
