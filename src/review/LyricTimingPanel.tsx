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
  onClose: () => void;
}

/** Start playback a moment before the line so the ear catches the attack. */
const PRE_ROLL_S = 1.0;

export default function LyricTimingPanel({
  rows,
  corrections,
  onCorrectionChange,
  onPlayFrom,
  onClose,
}: Props) {
  const { t, lang } = useI18n();
  const [onlySuspect, setOnlySuspect] = useState(false);
  const comma = lang === "pt";

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
                        className="lt-time"
                        title={t("ltPlayHint")}
                        onClick={() =>
                          onPlayFrom(Math.max(0, r.lrcTime - PRE_ROLL_S))
                        }
                      >
                        ▶ {formatTime(r.lrcTime)}
                      </button>
                    </td>
                    <td>
                      {r.heardTime === null ? (
                        <span className="lt-muted">—</span>
                      ) : (
                        <button
                          className="lt-time"
                          title={`${t("ltPlayHint")} (${r.heardSource ?? ""})`}
                          onClick={() =>
                            onPlayFrom(Math.max(0, (r.heardTime ?? 0) - PRE_ROLL_S))
                          }
                        >
                          ▶ {formatTime(r.heardTime)}
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

        <p className="lt-footer">{t("ltNotSavedYet")}</p>
      </div>
    </div>
  );
}
