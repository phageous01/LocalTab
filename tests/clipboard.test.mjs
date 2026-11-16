import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
Object.assign(globalThis, require("../vendor/xmldom/package/lib/index.js"));
const { ScoreDocument, applyDisplaySettings } = await import(
  "../public/editor-model.js"
);
const { copyNotes, pasteNotes, readNotes } = await import(
  "../public/clipboard.js"
);
const { xml } = await import("../public/model.js");
const alpha = require("../vendor/package/dist/alphaTab.js");
const sample = readFileSync(
  new URL("./fixtures/reference.musicxml", import.meta.url),
  "utf8",
);
function fresh() {
  const d = new ScoreDocument(sample);
  for (const m of d.measures.slice(2)) d.part.removeChild(m.el);
  d.refresh();
  return d;
}
function integrity(d) {
  const r = new ScoreDocument(d.serialize());
  assert(r.editable);
  assert(r.measures.every((m) => Math.abs(m.actualLength - m.length) < 1e-6));
  const s = alpha.importer.ScoreLoader.loadScoreFromBytes(
    new TextEncoder().encode(r.serialize()),
    new alpha.Settings(),
  );
  applyDisplaySettings(s, r);
  r.measures.forEach((m, i) =>
    assert.equal(
      s.tracks[0].staves[0].bars[i].voices[0].beats.length,
      m.notes.length,
    ),
  );
  return r;
}
const tonePrint = (b) => b.tones.map((t) => [t.string, t.fret, t.rest, t.dead]);

test("copy/paste chords, rests and markings without mutating the source or shifting following beats", () => {
  const d = fresh();
  d.setFret(0, 0, 1, 3);
  d.setFret(0, 0, 2, 5);
  d.setFret(0, 1, 1, 5);
  d.toggleDead(0, 1, 1);
  d.toggleMark(0, 0, "palm", 1);
  d.setBend(0, 0, 2, "bend-release", 1);
  d.setDynamic(0, 0, "mf");
  const before = d.serialize(),
    clip = copyNotes(d, 2, 0);
  assert.equal(d.serialize(), before);
  assert.equal(readNotes(clip).notes.length, 3);
  const at = d.notes.findIndex((n) => n.mi === 1),
    oldEnd = d.totalQ;
  pasteNotes(d, at, clip);
  for (let i = 0; i < 3; i++)
    assert.deepEqual(tonePrint(d.event(1, i)), tonePrint(d.event(0, i)));
  assert(d.marks(1, 0, 1).tags.has("palm"));
  assert(d.marks(1, 0, 1).tags.has("bend"));
  assert.equal(d.marks(1, 0).dynamic, "mf");
  assert.equal(d.totalQ, oldEnd);
  integrity(d);
});

test("cross-bar paste splits a sustained chord into tied notes and preserves destination tail", () => {
  const d = fresh();
  d.setFret(0, 0, 1, 7);
  d.setFret(0, 0, 2, 9);
  d.editDuration(0, 0, "half");
  const clip = copyNotes(d, 0),
    at = d.notes.findIndex((n) => n.q === 3);
  const tail = d.notes.find((n) => n.q === 5),
    tailPrint = tonePrint(tail);
  pasteNotes(d, at, clip);
  const a = d.notes.find((n) => n.q === 3),
    b = d.notes.find((n) => n.q === 4);
  assert.equal(a.duration, 1);
  assert.equal(b.duration, 1);
  assert(a.tones.every((t) => t.tieStart));
  assert(b.tones.every((t) => t.tieStop));
  assert.deepEqual(tonePrint(d.notes.find((n) => n.q === 5)), tailPrint);
  integrity(d);
});

test("triplet copy survives and a partial destination note keeps its remaining duration", () => {
  const d = fresh();
  d.setFret(0, 0, 1, 3);
  d.triplet(0, 0);
  d.setFret(0, 1, 1, 5);
  const allThree = copyNotes(d, 0, 2),
    at = d.notes.findIndex((n) => n.mi === 1);
  pasteNotes(d, at, allThree);
  assert.equal(d.event(1, 0).duration, 1 / 3);
  assert.equal(d.event(1, 1).fret, 5);
  integrity(d);
  const single = copyNotes(d, 1),
    target = fresh();
  target.setFret(0, 0, 2, 8);
  pasteNotes(target, 0, single);
  assert.equal(target.event(0, 0).duration, 1 / 3);
  assert.equal(target.event(0, 1).duration, 2 / 3);
  assert.equal(target.event(0, 1).fret, 8);
  integrity(target);
});

test("connections keep internal endpoints, omit external endpoints and use independent numbers", () => {
  const d = fresh();
  d.setFret(0, 0, 1, 3);
  d.setFret(0, 1, 1, 5);
  d.pair(0, 0, "hammer-on", 1, 1);
  assert(!copyNotes(d, 0).includes("hammer-on"));
  const clip = copyNotes(d, 0, 1),
    at = d.notes.findIndex((n) => n.mi === 1);
  pasteNotes(d, at, clip);
  const numbers = xml
    .all(d.part, "hammer-on")
    .map((n) => n.getAttribute("number"));
  assert.equal(numbers.length, 4);
  assert.equal(new Set(numbers).size, 2);
  integrity(d);
});

test("paste appends only needed measures and retains tempo changes at their original time", () => {
  const d = fresh();
  d.setTempo(1, 150);
  const clip = copyNotes(d, 0, 3),
    at = d.notes.length - 1;
  const result = pasteNotes(d, at, clip);
  assert.equal(result.addedBars, 1);
  assert.equal(d.measures.length, 3);
  assert.equal(d.tempoMap.find((t) => t.bpm === 150).q, 4);
  integrity(d);
});

test("tempo and text directions inside an overwritten span stay at their old score position", () => {
  const d = fresh();
  d.setFret(0, 0, 1, 3);
  d.editDuration(0, 0, "half");
  const clip = copyNotes(d, 0);
  const direction = d.doc.createElement("direction");
  const sound = xml.add(direction, "sound");
  sound.setAttribute("tempo", "155");
  d.measures[1].el.insertBefore(direction, d.event(1, 1).el);
  d.refresh();
  const original = d.tempoMap.find((t) => t.bpm === 155).q;
  pasteNotes(
    d,
    d.notes.findIndex((n) => n.mi === 1),
    clip,
  );
  assert.equal(d.tempoMap.find((t) => t.bpm === 155).q, original);
  integrity(d);
});

test("paste with a different tuning preserves string and fret and updates pitch", () => {
  const d = fresh();
  d.setFret(0, 0, 1, 3);
  const clip = copyNotes(d, 0);
  d.setTuning(["B0", "E1", "A1", "D2", "F#2"]);
  pasteNotes(d, 1, clip);
  assert.equal(d.event(0, 1).string, 1);
  assert.equal(d.event(0, 1).fret, 3);
  assert.equal(d.event(0, 1).midi, d.tuning.at(-1) + 3);
  integrity(d);
});

test("unsupported or malformed clipboard content fails atomically", () => {
  const d = fresh(),
    before = d.serialize();
  for (const clip of [
    "unrelated text",
    "{}",
    JSON.stringify({
      format: "localtab-notes",
      version: 1,
      tuning: [40, 45, 50, 55],
      xml: "<!DOCTYPE note><note/>",
    }),
  ]) {
    assert.throws(() => pasteNotes(d, 0, clip));
    assert.equal(d.serialize(), before);
  }
  const data = JSON.parse(copyNotes(d, 0));
  data.xml = data.xml.replace(
    "<duration>480</duration>",
    "<duration>-480</duration>",
  );
  assert.throws(() => pasteNotes(d, 0, JSON.stringify(data)));
  assert.equal(d.serialize(), before);
});

test("selection spans changing time signatures and can be pasted across them", () => {
  const d = fresh();
  d.setTimeSignature(1, 3, 4, "current", true);
  d.setFret(0, 2, 2, 3);
  d.setFret(0, 3, 2, 3);
  d.toggleTie(0, 2, 2);
  const clip = copyNotes(d, 2, 5),
    target = fresh();
  target.setTimeSignature(1, 6, 8, "current", true);
  const result = pasteNotes(target, 3, clip);
  assert(result.last > result.first);
  assert.equal(target.measures[1].beats, 6);
  assert.equal(target.measures[1].unit, 8);
  assert(target.notes.find((n) => n.q === 3).tones[0].tieStart);
  assert(target.notes.find((n) => n.q === 4).tones[0].tieStop);
  integrity(target);
});

test("unavailable target strings reject paste without changing notes or measures", () => {
  const source = fresh();
  source.setFret(0, 0, 5, 2);
  const clip = copyNotes(source, 0);
  const target = fresh();
  for (const b of [...target.notes]) if (!b.rest) target.toggleRest(b.mi, b.ni);
  target.setTuning(["E1", "A1", "D2", "G2"]);
  const before = target.serialize();
  assert.throws(
    () => pasteNotes(target, target.notes.length - 1, clip),
    /没有的弦/,
  );
  assert.equal(target.serialize(), before);
});

test("notes outside the pasted span keep their attributes and annotations", () => {
  const d = fresh();
  d.normalizeDivisions();
  const untouched = d.event(1, 2).el;
  untouched.setAttribute("default-x", "123.4");
  const lyric = xml.add(untouched, "lyric");
  xml.add(lyric, "text", "keep me");
  untouched.appendChild(d.doc.createComment("local annotation"));
  const before = new XMLSerializer().serializeToString(untouched);
  pasteNotes(d, 0, copyNotes(d, 1));
  assert.equal(new XMLSerializer().serializeToString(d.event(1, 2).el), before);
  integrity(d);
});

test("a valid note with an XML comment can still be copied and pasted", () => {
  const d = fresh();
  d.event(0, 0).el.appendChild(d.doc.createComment("note comment"));
  pasteNotes(d, 1, copyNotes(d, 0));
  integrity(d);
});
