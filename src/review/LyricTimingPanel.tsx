import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  TimingRow,
  formatGap,
  formatTime,
  parseTimeInput,
} from "./lrcTiming";

// Lyric timing table (step 1: look and type).
//
// Shows every line of the package's _synced_lyrics.lrc next to the time the
// AI actually measured for that line, and flags the ones that disagree. The
// user listens to those - in this screen's player or in their own - and types
// the real time where the .lrc is wrong.
//
// Nothing is saved yet: this step only collects the corrections. Saving them
// as an approved master, and making the pipeline obey it, is the next step.

interface Props {
  rows: TimingRow[];
  /** Raw text typed per .lrc line index - kept by the parent so it survives closing. */
  corrections: Record<number, string>;
  onCorrectionChange: (lrcIndex: number, raw: string) => void;
  /** Seek the review player to this second (already offset by the caller). */
  onPlayFrom: (sec: number) => void;
  /** Stop playback - the play buttons double as stop buttons. */
  onPause: () => void;
  /** Whether the review player is playing right now. */
  isPlaying: boolean;
  /** True when this song already has an approved version in the library. */
  hasApproved: boolean;
  /** Length of the audio the approved times were checked against, if known. */
  approvedAudioSeconds: number | null;
  /** Length of the audio loaded right now, if known. */
  audioSeconds: number | null;
  /** Where the last save landed, for the confirmation line. */
  approvedPath: string | null;
  approvedError: string | null;
  saving: boolean;
  onSaveApproved: () => void;
  onClose: () => void;
}

/**
 * How far the approved audio length may differ from the loaded file before the
 * panel warns. Two seconds covers re-encoding and trimming noise; a different
 * recording is normally out by far more than that.
 */
const AUDIO_LENGTH_TOLERANCE_S = 2.0;

/** Start playback a moment before the line so the ear catches the attack. */
const PRE_ROLL_S = 1.0;

export default function LyricTimingPanel({
  rows,
  corrections,
  onCorrectionChange,
  onPlayFrom,
  onPause,
  isPlaying,
  hasApproved,
  approvedAudioSeconds,
  audioSeconds,
  approvedPath,
  approvedError,
  saving,
  onSaveApproved,
  onClose,
}: Props) {
  const { t, lang } = useI18n();
  const [onlySuspect, setOnlySuspect] = useState(false);
  // Which play button started the current playback ("<row>:lrc" or
  // "<row>:heard"). Only that one turns into a stop button, and only while the
  // player is actually running - if playback ends or is stopped elsewhere, the
  // button goes back to ▶ on its own.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const comma = lang === "pt";

  const toggleFrom = (key: string, sec: number) => {
    if (activeKey === key && isPlaying) {
      onPause();
      return;
    }
    setActiveKey(key);
    onPlayFrom(sec);
  };
  const isStop = (key: string) => activeKey === key && isPlaying;

  const suspectCount = useMemo(
    () => rows.filter((r) => r.suspect).length,
    [rows]
  );
  const typedCount = useMemo(
    () =>
      Object.values(corrections).filter((v) => parseTimeInput(v) !== null)
        .length,
    [corrections]
  );
  const shown = onlySuspect ? rows.filter((r) => r.suspect) : rows;

  const audioMismatch =
    approvedAudioSeconds !== null &&
    audioSeconds !== null &&
    audioSeconds > 0 &&
    Math.abs(approvedAudioSeconds - audioSeconds) > AUDIO_LENGTH_TOLERANCE_S;

  return (
    <div className="lt-backdrop" onClick={onClose}>
      <div className="lt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lt-header">
          <h3>{t("ltTitle")}</h3>
          <button className="secondary" onClick={onClose}>
            {t("ltClose")}
          </button>
        </div>

        <p className="lt-help">{t("ltHelp")}</p>

        {hasApproved && <p className="lt-note ok">{t("ltApprovedLoaded")}</p>}
        {audioMismatch && (
          <p className="lt-note warn">
            {t("ltApprovedAudioWarn", {
              approved: formatTime(approvedAudioSeconds ?? 0),
              current: formatTime(audioSeconds ?? 0),
            })}
          </p>
        )}

        <div className="lt-toolbar">
          <span className="lt-summary">
            {t("ltSummary", {
              total: String(rows.length),
              suspect: String(suspectCount),
            })}
            {typedCount > 0
              ? ` · ${t("ltTypedCount", { n: String(typedCount) })}`
              : ""}
          </span>
          <label className="lt-filter">
            <input
              type="checkbox"
              checked={onlySuspect}
              onChange={(e) => setOnlySuspect(e.target.checked)}
            />
            {t("ltOnlySuspect")}
          </label>
        </div>

        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th className="lt-num">#</th>
                <th>{t("ltColLrc")}</th>
                <th>{t("ltColHeard")}</th>
                <th>{t("ltColGap")}</th>
                <th>{t("ltColText")}</th>
                <th>{t("ltColFix")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const raw = corrections[r.lrcIndex] ?? "";
                const parsed = parseTimeInput(raw);
                const bad = raw.trim() !== "" && parsed === null;
                return (
                  <tr
                    key={r.lrcIndex}
                    className={r.suspect ? "lt-row suspect" : "lt-row"}
                  >
                    <td className="lt-num">{r.lrcIndex + 1}</td>
                    <td>
                      <button
                        className={
                          isStop(`${r.lrcIndex}:lrc`) ? "lt-time playing" : "lt-time"
                        }
                        title={
                          isStop(`${r.lrcIndex}:lrc`)
                            ? t("ltStopHint")
                            : t("ltPlayHint")
                        }
                        onClick={() =>
                          toggleFrom(
                            `${r.lrcIndex}:lrc`,
                            Math.max(0, r.lrcTime - PRE_ROLL_S)
                          )
                        }
                      >
                        {isStop(`${r.lrcIndex}:lrc`) ? "⏸" : "▶"}{" "}
                        {formatTime(r.lrcTime)}
                      </button>
                    </td>
                    <td>
                      {r.heardTime === null ? (
                        <span className="lt-muted">—</span>
                      ) : (
                        <button
                          className={
                            isStop(`${r.lrcIndex}:heard`)
                              ? "lt-time playing"
                              : "lt-time"
                          }
                          title={`${
                            isStop(`${r.lrcIndex}:heard`)
                              ? t("ltStopHint")
                              : t("ltPlayHint")
                          } (${r.heardSource ?? ""})`}
                          onClick={() =>
                            toggleFrom(
                              `${r.lrcIndex}:heard`,
                              Math.max(0, (r.heardTime ?? 0) - PRE_ROLL_S)
                            )
                          }
                        >
                          {isStop(`${r.lrcIndex}:heard`) ? "⏸" : "▶"}{" "}
                          {formatTime(r.heardTime)}
                        </button>
                      )}
                    </td>
                    <td className={r.suspect ? "lt-gap suspect" : "lt-gap"}>
                      {r.verseIndex === null ? (
                        <span title={t("ltUnmatchedHint")}>{t("ltUnmatched")}</span>
                      ) : r.gap === null ? (
                        <span title={t("ltNoMeasureHint")}>{t("ltNoMeasure")}</span>
                      ) : (
                        formatGap(r.gap, comma)
                      )}
                    </td>
                    <td className="lt-text">{r.lrcText}</td>
                    <td>
                      <input
                        className={bad ? "lt-fix bad" : "lt-fix"}
                        type="text"
                        inputMode="decimal"
                        value={raw}
                        placeholder={t("ltFixPlaceholder")}
                        title={bad ? t("ltBadTime") : t("ltFixHint")}
                        onChange={(e) =>
                          onCorrectionChange(r.lrcIndex, e.target.value)
                        }
                      />
                      {parsed !== null && (
                        <span className="lt-fix-echo">{formatTime(parsed)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="lt-actions">
          <button
            className="submit-button compact"
            title={t("ltSaveApprovedHint")}
            onClick={onSaveApproved}
            disabled={saving || rows.length === 0}
          >
            {saving ? t("ltSaving") : t("ltSaveApproved")}
          </button>
          {approvedPath && !approvedError && (
            <span className="lt-note ok">
              {t("ltSavedTo", { path: approvedPath })}
            </span>
          )}
          {approvedError && <span className="lt-note bad">{approvedError}</span>}
        </div>
      </div>
    </div>
  );
}
