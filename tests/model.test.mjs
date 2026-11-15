import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  DOMParser,
  XMLSerializer,
} = require("../vendor/xmldom/package/lib/index.js");
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const { ScoreDocument, validateAnchors, qToTime, timeToQ } = await import(
  "../public/model.js"
);
const alpha = require("../vendor/package/dist/alphaTab.js");
const original = readFileSync(
  new URL("./fixtures/reference.musicxml", import.meta.url),
  "utf8",
);
const fresh = () => new ScoreDocument(original);
function fingerprint(doc) {
  return doc.notes.map((n) => [
    n.mi,
    n.q,
    n.duration,
    n.rest,
    n.midi,
    n.string,
    n.fret,
    n.dead,
    n.tieStart,
    n.tieStop,
  ]);
}
function importAlpha(xml) {
  const s = alpha.importer.ScoreLoader.loadScoreFromBytes(
    new TextEncoder().encode(xml),
    new alpha.Settings(),
  );
  const notes = [];
  for (const b of s.tracks[0].staves[0].bars)
    for (const v of b.voices)
      for (const beat of v.beats)
        for (const n of beat.notes)
          notes.push([
            b.index,
            6 - n.string,
            n.fret,
            n.realValue,
            n.isDead,
            n.isTieOrigin,
            n.isTieDestination,
          ]);
  return notes;
}
test("sample retains all notes, tuning, rhythm and special notes", () => {
  const d = fresh();
  assert.equal(d.measures.length, 80);
  assert.equal(d.notes.filter((n) => !n.rest).length, 316);
  assert.deepEqual(d.tuning, [23, 28, 33, 38, 43]);
  assert.equal(d.notes.filter((n) => n.dead).length, 2);
  assert.equal(d.notes.filter((n) => n.tieStart).length, 8);
  assert(d.measures.every((m) => m.actualLength === 4));
  assert.equal(d.editable, true);
});
test("serialize/reparse preserves every musical event and alphaTab import", () => {
  const d = fresh();
  assert.deepEqual(
    fingerprint(new ScoreDocument(d.serialize())),
    fingerprint(d),
  );
  const expected = d.notes
    .filter((n) => !n.rest)
    .map((n) => [
      n.mi,
      n.string,
      n.fret,
      n.midi,
      n.dead,
      n.tieStart,
      n.tieStop,
    ]);
  assert.deepEqual(importAlpha(d.serialize()), expected);
});
test("fret edit updates an entire tie chain; exported file renders exact result", () => {
  const d = fresh(),
    event = d.notes.find((n) => n.tieStart);
  const group = d.group(event);
  d.setFret(event.mi, event.ni, event.string, event.fret + 1);
  for (const n of group) {
    const updated = d.event(n.mi, n.ni);
    assert.equal(updated.fret, event.fret + 1);
    assert.equal(updated.midi, event.midi + 1);
  }
  const next = new ScoreDocument(d.serialize());
  assert.deepEqual(fingerprint(next), fingerprint(d));
  assert.equal(importAlpha(d.serialize()).length, 316);
});
test("rest entry, split, duration edit maintain measure length and divisions", () => {
  const d = fresh();
  d.setFret(0, 0, 5, 3);
  assert.equal(d.event(0, 0).midi, 26);
  d.split(0, 0);
  assert.equal(d.measures[0].notes.length, 5);
  assert.equal(d.measures[0].actualLength, 4);
  d.toggleRest(0, 1);
  d.setDuration(0, 0, 1);
  assert.equal(d.measures[0].notes.length, 4);
  assert(d.measures.every((m) => m.actualLength === 4));
  assert.equal(new ScoreDocument(d.serialize()).event(0, 0).duration, 1);
});
test("duration growth refuses overwriting following notes", () => {
  const d = fresh();
  assert.throws(() => d.setDuration(1, 0, 2), /休止符/);
});
test("custom tuning can preserve frets or sounding pitches", () => {
  const d = fresh(),
    old = d.notes.find((n) => !n.rest);
  d.setTuning(["A0", "D1", "G1", "C2", "F2"], "fret");
  assert.equal(d.event(old.mi, old.ni).midi, old.midi - 2);
  const d2 = fresh(),
    pitches = d2.notes.map((n) => n.midi);
  d2.setTuning(["A0", "D1", "G1", "C2", "F2"], "pitch");
  assert.deepEqual(
    d2.notes.map((n) => n.midi),
    pitches,
  );
});
test("append preserves the existing rhythm and adds one full measure", () => {
  const d = fresh();
  d.appendMeasure();
  assert.equal(d.measures.length, 81);
  assert(d.measures.every((m) => m.actualLength === 4));
  assert.equal(importAlpha(d.serialize()).length, 316);
});
test("piecewise sync is invertible; variable rate uses media time", () => {
  const a = validateAnchors([
    { q: 0, seconds: 0 },
    { q: 4, seconds: 1.25 },
    { q: 300, seconds: 135.250 },
    { q: 320, seconds: 146.875 },
  ]);
  for (const q of [0, 2, 4, 40, 150, 300, 310, 320])
    assert(Math.abs(timeToQ(qToTime(q, a), a) - q) < 1e-8);
  assert.equal(qToTime(4, a), 1.25);
  assert.throws(
    () =>
      validateAnchors([
        { q: 0, seconds: 0 },
        { q: 4, seconds: 0 },
      ]),
    /递增/,
  );
});
