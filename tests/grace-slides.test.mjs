import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
Object.assign(globalThis, require("../vendor/xmldom/package/lib/index.js"));
const { ScoreDocument, applyDisplaySettings, playbackEvents } = await import("../public/editor-model.js");
const { copyNotes, pasteNotes } = await import("../public/clipboard.js");
const { RecordingTimeMap } = await import("../public/sync.js");
const { xml } = await import("../public/model.js");
const alpha = require("../vendor/package/dist/alphaTab.js");
const sample = readFileSync(new URL("./fixtures/reference.musicxml", import.meta.url), "utf8");
function fresh() {
  const d = new ScoreDocument(sample);
  for (const m of d.measures.slice(2)) d.part.removeChild(m.el);
  d.refresh(); d.setFret(0, 0, 4, 7);
  return d;
}
function check(d) {
  const round = new ScoreDocument(d.serialize());
  assert(round.editable);
  assert(round.measures.every(m => Math.abs(m.actualLength - m.length) < 1e-6));
  for (const n of round.notes.filter(n => n.grace))
    for (const t of n.tones) assert.equal(xml.child(t.el, "duration"), undefined);
  return round;
}
function render(d) {
  const s = alpha.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(d.serialize()), new alpha.Settings());
  applyDisplaySettings(s, d);
  return s;
}

test("grace notes preserve measure, tempo and recording positions and round trip into the renderer", () => {
  const d = fresh(), before = d.notes.map(n => n.q), tempo = JSON.stringify(d.tempoMap);
  d.addGrace(0, 0, 4); d.setFret(0, 0, 4, 5);
  assert.deepEqual(d.notes.filter(n => !n.grace).map(n => n.q), before);
  assert.equal(JSON.stringify(d.tempoMap), tempo);
  const base = fresh(), anchors = [{q:0,seconds:1},{q:8,seconds:5}];
  assert.equal(new RecordingTimeMap(d, anchors).toTime(4), new RecordingTimeMap(base, anchors).toTime(4));
  d.normalizeDivisions(); check(d);
  let beats = render(d).tracks[0].staves[0].bars[0].voices[0].beats;
  assert.equal(beats.length, d.measures[0].notes.length);
  assert.equal(beats[0].graceType, alpha.model.GraceType.BeforeBeat);
  assert.equal(beats[0].notes[0].fret, 5);
  d.toggleGraceSlash(0, 0);
  beats = render(d).tracks[0].staves[0].bars[0].voices[0].beats;
  assert.equal(beats[0].graceType, alpha.model.GraceType.OnBeat);
});

test("grace chords, display duration, paired techniques and deletion retain the principal note", () => {
  const d = fresh(); d.addGrace(0, 0, 4); d.setFret(0, 0, 4, 5); d.setFret(0, 0, 3, 2);
  d.editDuration(0, 0, "16th", 1); d.pair(0, 0, "hammer-on", null, 4);
  assert.equal(d.event(0, 0).duration, 0);
  assert.equal(d.event(0, 0).tones.length, 2);
  const displayed = render(d).tracks[0].staves[0].bars[0].voices[0].beats[0];
  assert.equal(displayed.duration, 16); assert.equal(displayed.dots, 1);
  assert.equal(xml.all(d.event(0, 1).el, "hammer-on").length, 1);
  d.removeTone(0, 0, 3); d.removeTone(0, 0, 4);
  assert.equal(d.event(0, 0).fret, 7);
  assert.equal(xml.all(d.part, "hammer-on").length, 0);
  check(d);
});

test("ties skip intervening grace notes and invalid grace operations leave notation unchanged", () => {
  const d = fresh(); d.setFret(0, 1, 4, 7); d.addGrace(0, 1, 4); d.setFret(0, 1, 4, 5);
  d.toggleTie(0, 0, 4);
  assert(d.tone(0, 2, 4).tieStop);
  const pasted = fresh(); pasteNotes(pasted, 0, copyNotes(d, 0, 2));
  assert(pasted.tone(0, 0, 4).tieStart); assert(pasted.tone(0, 2, 4).tieStop);
  const before = d.serialize();
  assert.throws(() => d.toggleTie(0, 1, 4), /倚音/);
  assert.throws(() => d.triplet(0, 1), /倚音/);
  assert.throws(() => d.split(0, 1), /倚音/);
  assert.equal(d.serialize(), before); check(d);
});

test("copy/paste preserves grace groups, chords, open slides and paired endpoints", () => {
  const d = fresh(); d.addGrace(0, 0, 4); d.setFret(0, 0, 4, 5); d.setFret(0, 0, 3, 2);
  d.pair(0, 0, "hammer-on", null, 4); d.toggleOpenSlide(0, 1, "falloff", 4);
  const clip = copyNotes(d, 0, 1), target = fresh();
  pasteNotes(target, target.notes.findIndex(n => n.mi === 1), clip);
  assert(target.event(1, 0).grace);
  assert.equal(target.event(1, 0).tones.length, 2);
  assert.equal(target.event(1, 1).fret, 7);
  assert.equal(xml.all(target.measures[1].el, "hammer-on").length, 2);
  assert.equal(xml.all(target.measures[1].el, "falloff").length, 1);
  check(target); render(target);
});

test("a grace-only paste inserts before its target without consuming rhythmic time", () => {
  const source = fresh(); source.addGrace(0, 0, 4); source.setFret(0, 0, 4, 3);
  const target = fresh(); target.addGrace(0, 0, 4); target.setFret(0, 0, 4, 5);
  const result = pasteNotes(target, 1, copyNotes(source, 0));
  assert.deepEqual(target.measures[0].notes.slice(0, 3).map(n=>[n.grace,n.fret]), [[true,5],[true,3],[false,7]]);
  assert.equal(result.first, 1); assert.equal(result.last, 1);
  check(target);
});

test("cross-bar paste keeps slide-in only at the start and slide-out only at the end", () => {
  const source = fresh(); source.editDuration(0, 0, "half");
  source.toggleOpenSlide(0, 0, "scoop", 4); source.toggleOpenSlide(0, 0, "falloff", 4);
  const target = fresh(); pasteNotes(target, 3, copyNotes(source, 0));
  assert.equal(xml.all(target.event(0, 3).el, "scoop").length, 1);
  assert.equal(xml.all(target.event(0, 3).el, "falloff").length, 0);
  assert.equal(xml.all(target.event(1, 0).el, "scoop").length, 0);
  assert.equal(xml.all(target.event(1, 0).el, "falloff").length, 1);
  check(target);
});

test("a fragment ending with grace notes precedes the preserved tail at the same score time", () => {
  const source = fresh(); source.setFret(0, 1, 4, 9); source.addGrace(0, 1, 4);
  source.setFret(0, 1, 4, 5);
  const target = fresh(); target.editDuration(0, 0, "half");
  const result = pasteNotes(target, 0, copyNotes(source, 0, 1));
  assert.deepEqual(target.measures[0].notes.slice(0, 3).map(n=>[n.q,n.grace,n.fret]), [[0,false,7],[1,true,5],[1,false,7]]);
  assert.equal(result.first, 0); assert.equal(result.last, 1); check(target);
});

test("replacement and meter trimming do not leave orphan grace notes", () => {
  const d = fresh(); d.setFret(0, 2, 4, 9); d.addGrace(0, 2, 4);
  d.editDuration(0, 0, "whole"); assert.equal(xml.all(d.measures[0].el, "grace").length, 0); check(d);
  const trim = fresh(); trim.setFret(0, 3, 4, 9); trim.addGrace(0, 3, 4);
  trim.setTimeSignature(0, 3, 4, "current", true);
  assert.equal(xml.all(trim.measures[0].el, "grace").length, 0); check(trim);
});

test("all four open slides are standard per-string MusicXML and visible in TAB rendering", () => {
  const d = fresh(); d.setFret(0, 0, 3, 2);
  for (const [tag, field, value] of [["scoop","slideInType",1],["plop","slideInType",2],["doit","slideOutType",3],["falloff","slideOutType",4]]) {
    d.toggleOpenSlide(0, 0, tag, 4);
    assert.equal(xml.all(d.tone(0, 0, 4).el, tag).length, 1);
    assert.equal(xml.all(d.tone(0, 0, 3).el, tag).length, 0);
    assert.equal(xml.all(d.tone(0, 0, 4).el, tag)[0].parentNode.nodeName, "articulations");
    assert.equal(xml.all(d.tone(0, 0, 4).el, tag)[0].getAttribute("line-shape"), "straight");
    const b = render(check(d)).tracks[0].staves[0].bars[0].voices[0].beats[0];
    assert.equal(b.notes.find(n=>n.string===2)[field], value);
    assert.equal(b.notes.find(n=>n.string===3)[field], 0);
  }
  d.toggleOpenSlide(0, 0, "falloff", 4);
  assert.equal(xml.all(d.part, "falloff").length, 0);
  assert.equal(xml.all(d.part, "plop").length, 1);
});

test("open slides replace contradictory paired endpoints without affecting other markings", () => {
  const d = fresh(); d.setFret(0, 1, 4, 9); d.pair(0, 0, "slide", null, 4);
  d.toggleMark(0, 0, "palm", 4); d.toggleOpenSlide(0, 0, "falloff", 4);
  assert.equal(xml.all(d.part, "slide").length, 0);
  assert(d.marks(0, 0, 4).tags.has("palm"));
  d.pair(0, 0, "slide", null, 4);
  assert.equal(xml.all(d.part, "falloff").length, 0);
  d.toggleOpenSlide(0, 1, "scoop", 4);
  assert.equal(xml.all(d.part, "slide").length, 0); check(d);
});

test("grace preview has positive durations and leaves later main-note timing unchanged", () => {
  const d = fresh(); d.setFret(0, 1, 4, 9); d.addGrace(0, 0, 4); d.setFret(0, 0, 4, 5);
  d.addGrace(0, 0, 4); d.setFret(0, 0, 4, 3);
  const events = playbackEvents(d);
  assert.deepEqual(events.slice(0, 3).map(n=>n.fret), [3,5,7]);
  assert(events.every(n=>n.duration>0));
  assert.equal(events[2].q + events[2].duration, 1);
  assert.equal(events.find(n=>n.fret===9).q, 1);
});

test("unsupported timed or trailing imported grace notes remain viewable without rewriting them", () => {
  const d = fresh(); d.addGrace(0, 0, 4);
  xml.child(d.event(0, 0).el, "grace").setAttribute("make-time", "10");
  const data = d.serialize(), read = new ScoreDocument(data);
  assert.equal(read.editable, false); assert.equal(read.serialize(), data);
  const trailing = fresh(); trailing.addGrace(0, 0, 4);
  trailing.measures[0].el.appendChild(trailing.event(0, 0).el);
  trailing.refresh(); assert.equal(trailing.editable, false);
});
