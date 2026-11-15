import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
Object.assign(globalThis, require("../vendor/xmldom/package/lib/index.js"));
const { ScoreDocument, applyDisplaySettings, remapAnchors } = await import(
  "../public/editor-model.js"
);
const alpha = require("../vendor/package/dist/alphaTab.js");
const sample = readFileSync(
  new URL("./fixtures/reference.musicxml", import.meta.url),
  "utf8",
);
const fresh = () => new ScoreDocument(sample);
const imported = (d) => {
  const s = alpha.importer.ScoreLoader.loadScoreFromBytes(
    new TextEncoder().encode(d.serialize()),
    new alpha.Settings(),
  );
  applyDisplaySettings(s, d);
  return s;
};
const notes = (s) =>
  s.tracks[0].staves[0].bars[0].voices[0].beats.flatMap((b) => b.notes);
const integrity = (d) => {
  const r = new ScoreDocument(d.serialize());
  assert(r.editable);
  assert(r.measures.every((m) => Math.abs(m.actualLength - m.length) < 1e-6));
  return r;
};

test("triplets preserve a full measure, remain editable and round trip into alphaTab", () => {
  const d = fresh();
  d.setFret(0, 0, 4, 3);
  d.triplet(0, 0);
  assert.equal(d.event(0, 0).duration, 1 / 3);
  assert.equal(d.event(0, 0).type, "eighth");
  assert.equal(d.measures[0].notes.length, 6);
  d.setFret(0, 1, 4, 5);
  assert.equal(d.event(0, 1).fret, 5);
  integrity(d);
  const b = imported(d).tracks[0].staves[0].bars[0].voices[0].beats;
  assert.equal(b[0].tupletNumerator, 3);
  assert.equal(b[0].tupletDenominator, 2);
  assert.equal(b[0].duration, 8);
});
test("cancel triplets preserves note pitches and fills/consumes the remaining rhythm", () => {
  const d = fresh();
  d.setFret(0, 0, 4, 3);
  d.triplet(0, 0);
  d.setFret(0, 1, 4, 5);
  d.triplet(0, 1);
  assert.equal(d.event(0, 1).fret, 5);
  assert.equal(d.event(0, 1).duration, 0.5);
  assert.equal(d.event(0, 0).tuplet, false);
  integrity(d);
});
test("duration replacement and dots keep measure total, with explicit protected mode", () => {
  const d = fresh();
  d.editDuration(1, 0, "half", 0, "replace");
  assert.equal(d.event(1, 0).duration, 2);
  integrity(d);
  const p = fresh();
  assert.throws(() => p.editDuration(1, 0, "half", 0, "protect"), /保护模式/);
  const dotted = fresh();
  dotted.setFret(0, 0, 4, 3);
  dotted.toggleDots(0, 0);
  assert.equal(dotted.event(0, 0).duration, 1.5);
  dotted.toggleDots(0, 0);
  assert.equal(dotted.event(0, 0).duration, 1.75);
  integrity(dotted);
  assert.equal(
    imported(dotted).tracks[0].staves[0].bars[0].voices[0].beats[0].dots,
    2,
  );
});
test("hammer-on, pull-off, slide and slur persist paired endpoints", () => {
  for (const tag of ["hammer-on", "pull-off", "slide", "slur"]) {
    const d = fresh();
    d.setFret(0, 0, 4, tag === "pull-off" ? 5 : 3);
    d.setFret(0, 1, 4, tag === "pull-off" ? 3 : 5);
    d.pair(0, 0, tag);
    assert.equal(d.doc.getElementsByTagName(tag).length, 2);
    const ns = notes(imported(d));
    if (tag.includes("off") || tag.includes("on"))
      assert(ns[0].isHammerPullOrigin);
    if (tag === "slide") assert.equal(ns[0].slideOutType, 1);
    if (tag === "slur") assert(ns[0].isSlurOrigin);
    d.pair(0, 0, tag);
    assert.equal(d.doc.getElementsByTagName(tag).length, 0);
    integrity(d);
  }
});
test("bend, release, muted, harmonic, ghost and slap/pop rendering survive export", () => {
  const d = fresh();
  d.setFret(0, 0, 4, 3);
  for (const tag of ["palm", "let-ring", "ghost", "tap", "slap", "harmonic"])
    d.toggleMark(0, 0, tag);
  d.setBend(0, 0, 2, "bend-release");
  const n = notes(imported(d))[0];
  assert(n.isPalmMute);
  assert(n.isLetRing);
  assert(n.isGhost);
  assert(n.beat.tap);
  assert(n.beat.slap);
  assert(n.bendPoints.length >= 3);
  assert(d.serialize().includes("<other-technical>slap</other-technical>"));
  integrity(d);
});
test("dynamics, articulations, hairpins and tone text are actual MusicXML data", () => {
  const d = fresh();
  d.setFret(0, 0, 4, 3);
  d.setDynamic(0, 0, "sfz");
  d.toggleMark(0, 0, "staccato");
  d.setText(0, 0, "Pick · clean");
  d.hairpin(0, 0, "crescendo", 3);
  const s = imported(d),
    b = s.tracks[0].staves[0].bars[0].voices[0].beats[0];
  assert(b.text.includes("Pick"));
  assert(notes(s)[0].isStaccato);
  assert.equal(d.doc.getElementsByTagName("wedge").length, 2);
  assert.equal(d.doc.getElementsByTagName("sfz").length, 1);
  integrity(d);
});
test("insert/remove first or middle measure retains tuning and all original events", () => {
  const d = fresh(),
    pitches = d.notes.map((n) => n.midi);
  d.insertMeasure(0);
  assert.equal(d.measures.length, 81);
  assert.deepEqual(d.tuning, [23, 28, 33, 38, 43]);
  d.removeMeasure(0);
  assert.deepEqual(
    d.notes.map((n) => n.midi),
    pitches,
  );
  d.insertMeasure(10);
  d.removeMeasure(10);
  assert.deepEqual(
    d.notes.map((n) => n.midi),
    pitches,
  );
  integrity(d);
});
test("time signature edits restore following meter and reject accidental note loss", () => {
  const d = fresh();
  d.setTimeSignature(0, 3, 4);
  assert.equal(d.measures[0].length, 3);
  assert.equal(d.measures[1].length, 4);
  assert.equal(d.totalQ, 319);
  integrity(d);
  assert.throws(() => fresh().setTimeSignature(1, 3, 4), /截去音符/);
  const trim = fresh();
  trim.setTimeSignature(1, 3, 4, "current", true);
  assert.equal(trim.measures[1].actualLength, 3);
  integrity(trim);
  const compound = fresh();
  compound.setTimeSignature(0, 6, 8);
  assert.equal(compound.measures[0].unit, 8);
  integrity(compound);
});
test("structural edits retain audio timestamps while relocating musical anchors", () => {
  const d = fresh(),
    old = d.measures.map((m) => ({ el: m.el, q: m.q, length: m.length })),
    a = [
      { q: 0, seconds: 0 },
      { q: 4, seconds: 1.25 },
      { q: 300, seconds: 135.250 },
      { q: 320, seconds: 146.875 },
    ];
  d.insertMeasure(1);
  const next = remapAnchors(a, old, d.measures, 320, d.totalQ);
  assert.deepEqual(
    next.map((x) => x.q),
    [0, 8, 304, 324],
  );
  assert.deepEqual(
    next.map((x) => x.seconds),
    a.map((x) => x.seconds),
  );
  const before = d.measures.map((m) => ({
    el: m.el,
    q: m.q,
    length: m.length,
  }));
  d.removeMeasure(1);
  assert.deepEqual(remapAnchors(next, before, d.measures, 324, 320), a);
});
test("tempo map is invertible across meter/tempo changes", () => {
  const d = fresh();
  assert.equal(d.tempo, 134);
  d.setTempo(0, 120);
  d.setTempo(1, 60);
  assert.equal(d.qToSeconds(4), 2);
  assert.equal(d.qToSeconds(8), 6);
  for (const q of [0, 1, 4, 6, 30, 320])
    assert(Math.abs(d.secondsToQ(d.qToSeconds(q)) - q) < 1e-8);
});
test("rest entry within a triplet preserves its group bracket", () => {
  const d = fresh();
  d.triplet(0, 0);
  d.setFret(0, 0, 4, 3);
  d.toggleRest(0, 0);
  assert(d.event(0, 0).rest);
  assert.equal(d.doc.getElementsByTagName("tuplet").length, 2);
  integrity(d);
});
