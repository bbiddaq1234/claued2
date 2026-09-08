// GET /api/usage — 뉴런 사용량 + 오늘 발행 수 (6-12).
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { getUsage, publishedToday } from "@/lib/ai/cfUsage";
import { neuronsPerImage, roundNeurons, imagesPerDay } from "@/lib/ai/neurons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAILY_FREE_NEURONS = 10_000;

export async function GET() {
  const settings = getSettings();
  const usage = await getUsage(settings.cfImageSteps);
  const perImage = neuronsPerImage(settings.cfImageSteps);

  return NextResponse.json({
    neurons: {
      usedToday: roundNeurons(usage.neuronsToday),
      dailyFree: DAILY_FREE_NEURONS,
      source: usage.source, // "measured" | "estimated"
      perImage: roundNeurons(perImage),
      imagesPerDayAtCurrentSteps: imagesPerDay(settings.cfImageSteps, DAILY_FREE_NEURONS),
      steps: settings.cfImageSteps,
    },
    publish: {
      today: publishedToday(),
      dailyLimit: settings.dailyPublishLimit,
    },
  });
}
