import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
Object.assign(globalThis, require("../vendor/xmldom/package/lib/index.js"));
const { ScoreDocument, remapAnchors } = await import(
  "../public/editor-model.js"
);
const { validateAnchors, qToTime } = await import("../public/model.js");
const {
  RecordingTimeMap,
  SyncDraft,
  saveAnchor,
  locationToQ,
  qToLocation,
  parseTimestamp,
  formatTimestamp,
} = await import("../public/sync.js");
const sample = readFileSync(
  new URL("./fixtures/reference.musicxml", import.meta.url),
  "utf8",
);
const fresh = () => new ScoreDocument(sample);
const changingTempo = () => {
  const s = fresh();
  s.setTempo(0, 120);
  s.setTempo(1, 60);
  return s;
};
const close = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("no anchors follows the MusicXML tempo map, including inverse and extrapolation", () => {
  const score = changingTempo(),
    map = new RecordingTimeMap(score);
  close(map.toTime(4), 2);
  close(map.toTime(8), 6);
  for (const q of [-4, 0, 2, 4, 6, 320, 350]) {
    close(map.toTime(q), score.qToSeconds(q));
    close(map.toQ(map.toTime(q)), q);
  }
  // No audio length is used to stretch the score to the recording end.
  close(map.toQ(2), 4);
  close(map.toTime(0), 0);
});
test("one anchor offsets the complete tempo map without changing the tempo", () => {
  const map = new RecordingTimeMap(changingTempo(), [{ q: 4, seconds: 10 }]);
  close(map.toTime(0), 8);
  close(map.toTime(4), 10);
  close(map.toTime(8), 14);
  for (const q of [-4, 0, 4, 8, 320]) close(map.toQ(map.toTime(q)), q);
});
test("multiple anchors preserve tempo proportions within each segment and hit every endpoint", () => {
  const points = [
    { q: 0, seconds: 10 },
    { q: 8, seconds: 22 },
    { q: 12, seconds: 26 },
  ];
  const map = new RecordingTimeMap(changingTempo(), points);
  for (const a of points) {
    close(map.toTime(a.q), a.seconds);
    close(map.toQ(a.seconds), a.q);
  }
  close(map.toTime(4), 14); // First two nominal seconds out of six, stretched by 2.
  close(map.toTime(6), 18);
  close(map.toTime(10), 24);
  close(map.toTime(-4), 6);
  close(map.toTime(16), 30);
  for (const q of [-10, -1, 0, 3, 4, 7, 8, 11, 12, 25, 350])
    close(map.toQ(map.toTime(q)), q);
});
test("the synthetic constant-tempo score keeps its existing anchor mapping exactly", () => {
  const points = [
    { q: 0, seconds: 0 },
    { q: 4, seconds: 1.25 },
    { q: 300, seconds: 135.250 },
    { q: 320, seconds: 146.875 },
  ];
  const before = structuredClone(points),
    map = new RecordingTimeMap(fresh(), points);
  for (const q of [0, 1, 4, 16, 103.5, 299, 300, 319, 320])
    close(map.toTime(q), qToTime(q, points));
  assert.deepEqual(points, before);
});
test("recording times stay independent across recordings and playback rate", () => {
  const score = fresh(),
    first = [{ q: 4, seconds: 1.25 }],
    second = [{ q: 4, seconds: 1.375 }];
  const a = new RecordingTimeMap(score, first),
    b = new RecordingTimeMap(score, second);
  for (const rate of [0.5, 0.73, 1]) {
    const wallSeconds = 3,
      mediaSeconds = 1.25 + wallSeconds * rate;
    close(a.toQ(mediaSeconds), 4 + (wallSeconds * rate * 134) / 60);
  }
  close(b.toTime(4) - a.toTime(4), 0.125);
  assert.deepEqual(first, [{ q: 4, seconds: 1.25 }]);
});
test("anchors can grow from zero to one to many, and shrink back to zero", () => {
  const first = saveAnchor([], { q: 4, seconds: 1 }, 320, 150);
  const second = saveAnchor(first, { q: 8, seconds: 3 }, 320, 150);
  assert.deepEqual(first, [{ q: 4, seconds: 1 }]);
  assert.equal(second.length, 2);
  assert.deepEqual(validateAnchors(second.slice(0, 1)), first);
  assert.deepEqual(validateAnchors([]), []);
  assert.deepEqual(saveAnchor(second, { q: 4, seconds: 2 }, 320, 150), [
    { q: 4, seconds: 2 },
    { q: 8, seconds: 3 },
  ]);
  assert.equal(first[0].seconds, 1); // Saving never mutates history snapshots.
});
test("invalid edits reject overlapping positions, reversed time and out-of-file anchors", () => {
  const points = [
    { q: 4, seconds: 1 },
    { q: 8, seconds: 3 },
  ];
  assert.throws(
    () => saveAnchor(points, { q: 8, seconds: 2 }, 320, 150, 0),
    /已有同步点/,
  );
  assert.throws(
    () => saveAnchor(points, { q: 6, seconds: 5 }, 320, 150),
    /递增/,
  );
  for (const q of [-1, 321, NaN])
    assert.throws(() => saveAnchor(points, { q, seconds: 2 }, 320, 150));
  for (const seconds of [-1, 151, Infinity, NaN])
    assert.throws(() => saveAnchor(points, { q: 6, seconds }, 320, 150));
  assert.throws(() => saveAnchor(points, { q: 6, seconds: 2 }, 320, 150, 2));
  assert.deepEqual(points, [
    { q: 4, seconds: 1 },
    { q: 8, seconds: 3 },
  ]);
});
test("sync draft freezes the recording timestamp when selecting different measures and beats", () => {
  const score = fresh(),
    draft = new SyncDraft("original", 14.157, 0);
  draft.selectLocation(score, 8);
  assert.equal(draft.q, 28);
  draft.selectLocation(score, 10, 2.5);
  assert.equal(draft.q, 37.5);
  assert.equal(draft.seconds, 14.157);
  assert.deepEqual(draft.save([], 320, 150), [{ q: 37.5, seconds: 14.157 }]);
});
test("measure conversion supports fractional quarter-note positions and an explicit end", () => {
  const score = fresh();
  close(locationToQ(score, 1, 4.75), 3.75);
  assert.deepEqual(qToLocation(score, 3.75), { measure: 1, beat: 4.75 });
  close(locationToQ(score, 81), 320);
  assert.deepEqual(qToLocation(score, 320), { measure: 81, beat: 1 });
  assert.throws(() => locationToQ(score, 81, 2));
  assert.throws(() => locationToQ(score, 1, 5));
  score.setTimeSignature(0, 6, 8, "current", true);
  close(locationToQ(score, 1, 3.5), 2.5);
  assert.throws(() => locationToQ(score, 1, 4));
});
test("timestamp parsing is millisecond-precise and formatting carries into the next minute", () => {
  close(parseTimestamp("00:14.157"), 14.157);
  close(parseTimestamp("135.250"), 135.250);
  assert.equal(formatTimestamp(135.250), "02:15.250");
  assert.equal(formatTimestamp(59.9996), "01:00.000");
  for (const s of ["-1", "", "1:60", "hello", "1:2:3", "NaN", "1.2345"])
    assert.throws(() => parseTimestamp(s));
});
test("structural edits can leave one or zero anchors without corrupting timing", () => {
  const score = fresh(),
    prev = score.measures.map((m) => ({ el: m.el, q: m.q, length: m.length }));
  score.removeMeasure(1);
  assert.deepEqual(
    remapAnchors(
      [
        { q: 4, seconds: 1 },
        { q: 8, seconds: 3 },
      ],
      prev,
      score.measures,
      320,
      316,
    ),
    [{ q: 4, seconds: 3 }],
  );
  assert.deepEqual(
    remapAnchors([{ q: 4, seconds: 1 }], prev, score.measures, 320, 316),
    [],
  );
});
