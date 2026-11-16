// The practice start is a deliberate score selection, independent of the
// moving playhead. It is session state, not notation or recording metadata.
export class PlaybackResume {
  startMeasure = 0;
  reset() { this.startMeasure = 0; }
  select(score, measure) {
    this.startMeasure = Math.max(0, Math.min(score.measures.length - 1,
      Number.isInteger(measure) ? measure : 0));
  }
  position(score, pausedQ, source = "paused") {
    const q = Math.max(0, Math.min(score.totalQ, Number.isFinite(pausedQ) ? pausedQ : 0));
    if (source === "exact") return q; // Live speed changes and timeline seeking.
    if (source === "practice") {
      this.select(score, this.startMeasure);
      return score.measures[this.startMeasure]?.q ?? 0;
    }
    return (score.measures.findLast((measure) => measure.q <= q) || score.measures[0])?.q ?? 0;
  }
  remap(previous, score) {
    const element = previous[this.startMeasure]?.el;
    const next = element ? score.measures.findIndex((measure) => measure.el === element) : -1;
    // If the start bar is deleted, use its successor, or the new last bar.
    this.select(score, next < 0 ? this.startMeasure : next);
  }
}
