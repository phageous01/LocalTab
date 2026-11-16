import { t as tr } from "./i18n.js";
import { validateAnchors } from "./model.js";

export const SYNC_ALGORITHM = "tempo-map-v1";

// Map the score's nominal elapsed seconds, rather than raw beat counts, to
// recording time. Leave clamping to the player so both directions stay invertible.
export class RecordingTimeMap {
  constructor(score, anchors = []) {
    this.score = score;
    this.points = validateAnchors(anchors).map((a) => ({
      ...a,
      scoreSeconds: score.qToSeconds(a.q),
    }));
  }
  interpolate(value, from, to) {
    const p = this.points;
    if (!p.length) return value;
    if (p.length === 1) return value - p[0][from] + p[0][to];
    let i = p.findIndex((a) => a[from] > value);
    if (i < 0) i = p.length - 1;
    if (i === 0) i = 1;
    const a = p[i - 1],
      b = p[i];
    return a[to] + ((value - a[from]) * (b[to] - a[to])) / (b[from] - a[from]);
  }
  toTime(q) {
    return this.interpolate(
      this.score.qToSeconds(q),
      "scoreSeconds",
      "seconds",
    );
  }
  toQ(seconds) {
    return this.score.secondsToQ(
      this.interpolate(seconds, "seconds", "scoreSeconds"),
    );
  }
}

export function formatTimestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export function parseTimestamp(text) {
  const m = /^(?:(\d+):)?(\d+(?:\.\d{1,3})?)$/.exec(text.trim());
  if (!m || (m[1] !== undefined && Number(m[2]) >= 60))
    throw Error(tr("时间格式如 00:14.157 或 14.157 秒"));
  const seconds = Number(m[1] || 0) * 60 + Number(m[2]);
  if (!Number.isFinite(seconds)) throw Error(tr("录音时间无效"));
  return seconds;
}
export function locationToQ(score, measure, beat = 1) {
  if (
    !Number.isInteger(measure) ||
    measure < 1 ||
    measure > score.measures.length + 1 ||
    !Number.isFinite(beat) ||
    beat < 1
  )
    throw Error(tr("小节或拍位无效"));
  if (measure === score.measures.length + 1) {
    if (beat !== 1) throw Error(tr("结束位置的拍位应为 1"));
    return score.totalQ;
  }
  const bar = score.measures[measure - 1];
  if (beat - 1 >= bar.length) throw Error(tr("拍位超出该小节"));
  return bar.q + beat - 1;
}
export function qToLocation(score, q) {
  if (q >= score.totalQ - 1e-6)
    return { measure: score.measures.length + 1, beat: 1 };
  const bar = score.measures.findLast((m) => m.q <= q) || score.measures[0];
  return { measure: bar.index + 1, beat: 1 + q - bar.q };
}
export function saveAnchor(anchors, point, totalQ, duration, editIndex = null) {
  if (!Number.isFinite(point.q) || point.q < 0 || point.q > totalQ)
    throw Error(tr("同步点超出乐谱范围"));
  if (
    !Number.isFinite(point.seconds) ||
    point.seconds < 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    point.seconds > duration + 0.0005
  )
    throw Error(tr("同步点超出录音时长"));
  const next = anchors.map((a) => ({ ...a }));
  const duplicate = next.findIndex((a) => Math.abs(a.q - point.q) < 1e-6);
  if (
    editIndex != null &&
    (!Number.isInteger(editIndex) || editIndex < 0 || editIndex >= next.length)
  )
    throw Error(tr("同步点已改变，请重新打开"));
  if (editIndex != null && duplicate >= 0 && duplicate !== editIndex)
    throw Error(tr("该小节或拍位已有同步点，请选择其他位置"));
  const index = editIndex ?? (duplicate < 0 ? next.length : duplicate);
  next[index] = { ...point };
  return validateAnchors(next);
}

// The draft is deliberately independent of the player: selecting the destination
// can never replace the timestamp captured when the user opened the editor.
export class SyncDraft {
  constructor(recordingId, seconds, q, editIndex = null) {
    this.recordingId = recordingId;
    this.seconds = seconds;
    this.q = q;
    this.editIndex = editIndex;
  }
  selectLocation(score, measure, beat = 1) {
    this.q = locationToQ(score, measure, beat);
  }
  save(anchors, totalQ, duration) {
    return saveAnchor(
      anchors,
      { q: this.q, seconds: this.seconds },
      totalQ,
      duration,
      this.editIndex,
    );
  }
}
