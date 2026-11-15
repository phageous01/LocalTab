import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
Object.assign(globalThis, require("../vendor/xmldom/package/lib/index.js"));
const { ScoreDocument, applyDisplaySettings, playbackEvents } = await import(
  "../public/editor-model.js"
);
const { xml } = await import("../public/model.js");
const alpha = require("../vendor/package/dist/alphaTab.js");
const source = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Guitar</part-name><score-instrument id="I1"><instrument-name>Guitar</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>25</midi-program></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef><staff-details><staff-lines>6</staff-lines>${[
  ["E", 2],
  ["A", 2],
  ["D", 3],
  ["G", 3],
  ["B", 3],
  ["E", 4],
]
  .map(
    ([step, oct], i) =>
      `<staff-tuning line="${i + 1}"><tuning-step>${step}</tuning-step><tuning-octave>${oct}</tuning-octave></staff-tuning>`,
  )
  .join(
    "",
  )}</staff-details></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>${Array.from({ length: 4 }, () => "<note><rest/><duration>480</duration><voice>1</voice><type>quarter</type></note>").join("")}</measure></part></score-partwise>`;
const fresh = () => new ScoreDocument(source);
const em = (d, ni = 0) =>
  [0, 2, 2, 0, 0, 0].forEach((f, i) => d.setFret(0, ni, 6 - i, f));
const imported = (d) => {
  const s = alpha.importer.ScoreLoader.loadScoreFromBytes(
    new TextEncoder().encode(d.serialize()),
    new alpha.Settings(),
  );
  applyDisplaySettings(s, d);
  return s.tracks[0].staves[0].bars;
};
const fingerprint = (d) =>
  d.notes.map((b) => [
    b.q,
    b.duration,
    b.tones.map((t) => [
      t.string,
      t.fret,
      t.midi,
      t.rest,
      t.dead,
      t.tieStart,
      t.tieStop,
    ]),
  ]);
const integrity = (d) => {
  assert(d.editable);
  assert(d.measures.every((m) => Math.abs(m.actualLength - m.length) < 1e-6));
  for (const b of d.notes) {
    assert.equal(new Set(b.tones.map((t) => t.string)).size, b.tones.length);
    assert(b.tones.every((t) => t.q === b.q && t.duration === b.duration));
  }
  const r = new ScoreDocument(d.serialize());
  assert.deepEqual(fingerprint(r), fingerprint(d));
  const bars = imported(d);
  for (const m of d.measures) {
    assert.equal(bars[m.index].voices[0].beats.length, m.notes.length);
    m.notes.forEach((b, i) => {
      const ns = bars[m.index].voices[0].beats[i].notes;
      assert.equal(ns.length, b.rest ? 0 : b.tones.length);
      assert.deepEqual(
        ns
          .map((n) => [6 - n.string + 1, n.fret, n.realValue])
          .sort((a, b) => a[0] - b[0]),
        b.rest
          ? []
          : b.tones
              .map((t) => [t.string, t.fret, t.midi])
              .sort((a, b) => a[0] - b[0]),
      );
    });
  }
};

test("six-string chord uses one beat, imports all tones and updates only the addressed string", () => {
  const d = fresh();
  em(d);
  assert.equal(d.event(0, 0).tones.length, 6);
  assert.equal(d.notes.length, 4);
  assert.equal(d.doc.getElementsByTagName("chord").length, 5);
  d.setFret(0, 0, 2, 12);
  assert.equal(d.tone(0, 0, 2).fret, 12);
  assert.equal(d.tone(0, 0, 6).fret, 0);
  assert.equal(d.event(0, 0).tones.length, 6);
  integrity(d);
});
test("delete removes only one string, promotes a chord root and turns the last tone into a rest", () => {
  const d = fresh();
  em(d);
  d.setDynamic(0, 0, "mf");
  d.removeTone(0, 0, 6);
  assert.equal(d.event(0, 0).tones.length, 5);
  assert.equal(xml.child(d.event(0, 0).el, "chord"), undefined);
  assert.equal(d.marks(0, 0).dynamic, "mf");
  d.removeTone(0, 0, 3);
  const snapshot = d.serialize();
  d.removeTone(0, 0, 3);
  assert.equal(d.serialize(), snapshot);
  integrity(d);
  for (const string of [5, 4, 2, 1]) d.removeTone(0, 0, string);
  assert(d.event(0, 0).rest);
  integrity(d);
});
test("duration, dots, split and protected edits operate on whole chords", () => {
  const d = fresh();
  em(d);
  em(d, 1);
  assert.throws(() => d.editDuration(0, 0, "half", 0, "protect"), /保护/);
  d.editDuration(0, 0, "half");
  assert.equal(d.event(0, 0).tones.length, 6);
  assert(d.event(0, 0).tones.every((t) => t.duration === 2));
  integrity(d);
  d.split(0, 0);
  assert.equal(d.event(0, 1).tones.length, 6);
  integrity(d);
  d.toggleDots(0, 0);
  assert(d.event(0, 0).tones.every((t) => t.duration === 1.5));
  integrity(d);
  d.setDuration(0, 0, 1);
  integrity(d);
});
test("triplets duplicate entire chords and keep their bracket when deleting the first tone", () => {
  const d = fresh();
  em(d);
  d.triplet(0, 0);
  assert.deepEqual(
    d.measures[0].notes.slice(0, 3).map((b) => b.tones.length),
    [6, 6, 6],
  );
  d.removeTone(0, 0, 6);
  assert.equal(
    xml.all(d.event(0, 0).el, "tuplet")[0].getAttribute("type"),
    "start",
  );
  integrity(d);
  d.triplet(0, 1);
  assert.equal(d.event(0, 0).tuplet, false);
  integrity(d);
});
test("ties and playback follow the chosen string independently of other chord tones", () => {
  const d = fresh();
  em(d);
  em(d, 1);
  d.toggleTie(0, 0, 6);
  d.toggleTie(0, 0, 2);
  d.setFret(0, 0, 6, 3);
  assert.equal(d.tone(0, 1, 6).fret, 3);
  assert.equal(d.tone(0, 1, 5).fret, 2);
  const events = playbackEvents(d);
  assert.equal(events.filter((e) => e.q === 0).length, 6);
  assert.equal(events.filter((e) => e.q === 1).length, 4);
  assert.equal(events.find((e) => e.q === 0 && e.string === 6).duration, 2);
  assert.equal(events.find((e) => e.q === 0 && e.string === 5).duration, 1);
  d.removeTone(0, 0, 6);
  assert.equal(d.tone(0, 1, 6).tieStop, false);
  assert.equal(d.tone(0, 0, 2).tieStart, true);
  integrity(d);
});
test("dead notes, bends and paired techniques target the selected chord tone", () => {
  const d = fresh();
  em(d);
  em(d, 1);
  d.toggleDead(0, 0, 4);
  d.setBend(0, 0, 2, "bend", 1);
  d.setFret(0, 1, 3, 2);
  d.pair(0, 0, "hammer-on", null, 3);
  assert(d.tone(0, 0, 4).dead);
  assert(!d.tone(0, 0, 6).dead);
  assert(d.marks(0, 0, 1).tags.has("bend"));
  assert(!d.marks(0, 0, 6).tags.has("bend"));
  const notes = imported(d)[0].voices[0].beats[0].notes;
  assert(notes.find((n) => n.string === 3).isDead);
  assert(notes.find((n) => n.string === 6).bendPoints.length > 0);
  d.removeTone(0, 0, 3);
  assert.equal(xml.all(d.tone(0, 1, 3).el, "hammer-on").length, 0);
  integrity(d);
  assert.throws(() => d.toggleDead(0, 0, 3), /没有音符/);
});
test("whole-beat rest clears chord connections but preserves unrelated subsequent tones", () => {
  const d = fresh();
  em(d);
  em(d, 1);
  d.toggleTie(0, 0, 6);
  d.toggleTie(0, 0, 1);
  d.toggleRest(0, 0);
  assert(d.event(0, 0).rest);
  assert.equal(d.event(0, 1).tones.length, 6);
  assert(d.event(0, 1).tones.every((t) => !t.tieStop));
  integrity(d);
});
test("retuning preserves all chord pitches on distinct strings and refuses impossible reductions", () => {
  const d = fresh();
  em(d);
  em(d, 1);
  d.toggleTie(0, 0, 6);
  const pitches = d.notes.flatMap((b) => b.tones).map((t) => t.midi);
  d.setTuning(["D2", "A2", "D3", "G3", "B3", "E4"], "pitch");
  assert.deepEqual(
    d.notes.flatMap((b) => b.tones).map((t) => t.midi),
    pitches,
  );
  assert.equal(d.tone(0, 0, 6).fret, 2);
  assert.equal(d.tone(0, 1, 6).fret, 2);
  integrity(d);
  const before = d.serialize();
  assert.throws(
    () => d.setTuning(["E2", "A2", "D3", "G3", "B3"], "pitch"),
    /不同弦/,
  );
  assert.equal(d.serialize(), before);
});
test("time signatures and structural edits preserve chords without multiplying elapsed time", () => {
  const d = fresh();
  em(d, 3);
  assert.throws(() => d.setTimeSignature(0, 3, 4), /截去/);
  d.setTimeSignature(0, 3, 4, "current", true);
  assert.equal(d.notes.length, 3);
  integrity(d);
  em(d, 0);
  d.editDuration(0, 0, "half", 1);
  d.setTimeSignature(0, 2, 4, "current", true);
  assert.equal(d.event(0, 0).tones.length, 6);
  assert.equal(d.event(0, 0).duration, 2);
  integrity(d);
  d.insertMeasure(0);
  d.removeMeasure(0);
  integrity(d);
  const direction = d.doc.createElement("direction");
  xml.add(direction, "sound").setAttribute("tempo", "60");
  d.measures[0].el.appendChild(direction);
  d.refresh();
  assert.equal(d.tempoMap.at(-1).q, 2);
});
test("unsupported overlapping rhythms and duplicate-string imports remain read-only", () => {
  const d = fresh();
  em(d);
  xml.set(d.tone(0, 0, 1).el, "duration", 240);
  d.refresh();
  assert.equal(d.editable, false);
  const duplicate = fresh();
  em(duplicate);
  xml.set(xml.all(duplicate.tone(0, 0, 1).el, "technical")[0], "string", 2);
  duplicate.refresh();
  assert.equal(duplicate.editable, false);
});
