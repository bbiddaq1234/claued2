"use client";

// 설정 서랍 — 우측 슬라이드. 3개 묶음: 발행 안전장치 / 글감과 사진 / 실행 방식 (6-13).
import { useEffect, useState } from "react";
import { neuronsPerImage, roundNeurons } from "@/lib/ai/neurons";

export interface Settings {
  dryRun: boolean;
  killSwitch: boolean;
  visibility: "public" | "neighbor" | "both" | "private";
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
  scrapeTopN: number;
  imageCandidates: number;
  cfImageSteps: number;
  showBrowser: boolean;
  claudeTimeoutSec: number;
  claudeConcurrency: number;
}

export interface Limits {
  visibility: readonly string[];
  dailyPublishLimit: { min: number; max: number };
  minPublishIntervalMin: { min: number; max: number };
  scrapeTopN: { min: number; max: number };
  imageCandidates: { min: number; max: number };
  cfImageSteps: { min: number; max: number };
  claudeTimeoutSec: { min: number; max: number };
  claudeConcurrency: { min: number; max: number };
}

const VISIBILITY_LABEL: Record<string, string> = {
  public: "전체공개",
  neighbor: "이웃공개",
  both: "서로이웃공개",
  private: "비공개(권장)",
};

export default function SettingsDrawer({
  open,
  settings,
  limits,
  onClose,
  onChange,
}: {
  open: boolean;
  settings: Settings | null;
  limits: Limits | null;
  onClose: () => void;
  onChange: (next: Partial<Settings> | { reset: true }) => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!settings || !limits) return null;

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`drawer ${open ? "drawer-open" : ""}`} aria-hidden={!open}>
        <div className="drawer-head">
          <h2>설정</h2>
          <button className="btn-icon" onClick={onClose} aria-label="설정 닫기">
            ✕
          </button>
        </div>

        <section className="drawer-section">
          <h3>발행 안전장치</h3>
          <ToggleRow
            label="연습 모드"
            help="켜두면 발행 없이 완성 화면만 저장합니다."
            checked={settings.dryRun}
            onChange={(v) => onChange({ dryRun: v })}
          />
          <ToggleRow
            label="전체 중단"
            help="켜면 어떤 작업도 발행되지 않습니다."
            checked={settings.killSwitch}
            onChange={(v) => onChange({ killSwitch: v })}
          />
          <label className="field">
            <span>공개 범위</span>
            <select
              value={settings.visibility}
              onChange={(e) => onChange({ visibility: e.target.value as Settings["visibility"] })}
            >
              {limits.visibility.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v] ?? v}
                </option>
              ))}
            </select>
          </label>
          <NumberRow
            label="하루 발행 수"
            value={settings.dailyPublishLimit}
            min={limits.dailyPublishLimit.min}
            max={limits.dailyPublishLimit.max}
            suffix="편"
            onChange={(v) => onChange({ dailyPublishLimit: v })}
          />
          <NumberRow
            label="발행 간격"
            value={settings.minPublishIntervalMin}
            min={limits.minPublishIntervalMin.min}
            max={limits.minPublishIntervalMin.max}
            suffix="분"
            onChange={(v) => onChange({ minPublishIntervalMin: v })}
          />
        </section>

        <section className="drawer-section">
          <h3>글감과 사진</h3>
          <NumberRow
            label="검색 수집량"
            value={settings.scrapeTopN}
            min={limits.scrapeTopN.min}
            max={limits.scrapeTopN.max}
            suffix="건"
            onChange={(v) => onChange({ scrapeTopN: v })}
          />
          <NumberRow
            label="이미지 후보"
            value={settings.imageCandidates}
            min={limits.imageCandidates.min}
            max={limits.imageCandidates.max}
            suffix="개"
            onChange={(v) => onChange({ imageCandidates: v })}
          />
          <NumberRow
            label="생성 품질(스텝)"
            value={settings.cfImageSteps}
            min={limits.cfImageSteps.min}
            max={limits.cfImageSteps.max}
            suffix="스텝"
            onChange={(v) => onChange({ cfImageSteps: v })}
          />
          <p className="drawer-hint">
            지금은 장당 {roundNeurons(neuronsPerImage(settings.cfImageSteps))} 뉴런 — 무료 한도로 하루{" "}
            {Math.floor(10_000 / neuronsPerImage(settings.cfImageSteps))}장쯤 만들 수 있어요.
          </p>
        </section>

        <section className="drawer-section">
          <h3>실행 방식</h3>
          <ToggleRow
            label="브라우저 보기"
            help="켜면 자동화 중인 브라우저 창이 화면에 보입니다."
            checked={settings.showBrowser}
            onChange={(v) => onChange({ showBrowser: v })}
          />
          <NumberRow
            label="AI 동시 실행"
            value={settings.claudeConcurrency}
            min={limits.claudeConcurrency.min}
            max={limits.claudeConcurrency.max}
            suffix="개"
            onChange={(v) => onChange({ claudeConcurrency: v })}
          />
          <NumberRow
            label="AI 응답 대기"
            value={settings.claudeTimeoutSec}
            min={limits.claudeTimeoutSec.min}
            max={limits.claudeTimeoutSec.max}
            suffix="초"
            onChange={(v) => onChange({ claudeTimeoutSec: v })}
          />
        </section>

        <div className="drawer-foot">
          <button className="btn" onClick={() => onChange({ reset: true })}>
            기본값으로 되돌리기
          </button>
        </div>
      </aside>
    </>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div>
        <span>{label}</span>
        {help && <p className="drawer-hint">{help}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? "switch-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  // ⚠️ 입력 중에는 자유롭게 두고, 서버가 저장 시점에 클램프한다(6-11) — 여기서
  // 타이핑 도중 범위를 강제로 막지 않는다.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <label className="field field-number">
      <span>
        {label} <em className="field-range">({min}~{max}{suffix})</em>
      </span>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          onChange(Number.isFinite(n) ? n : value);
        }}
      />
    </label>
  );
}
