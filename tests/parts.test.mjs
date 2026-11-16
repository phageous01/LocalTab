import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
Object.assign(globalThis, require("../vendor/xmldom/package/lib/index.js"));
const { ScoreDocument, applyDisplaySettings } = await import("../public/editor-model.js");
const { copyNotes, pasteNotes } = await import("../public/clipboard.js");
const alpha = require("../vendor/package/dist/alphaTab.js");
const sample = readFileSync(new URL("./fixtures/reference.musicxml", import.meta.url), "utf8");
const guitar = ["E2", "A2", "D3", "G3", "B3", "E4"];
const partXML = (model, index) => new XMLSerializer().serializeToString(model.parts[index]);

test("add/select/edit/paste preserves every other part and restores the selected part", () => {
  const model = new ScoreDocument(sample), original = partXML(model, 0);
  const id = model.addPart("吉他 Guitar <lead>", guitar);
  assert.equal(model.parts.length, 2); assert.equal(model.activePartId, id);
  assert.equal(model.partInfos[1].name, "吉他 Guitar <lead>");
  assert(model.editable); assert.equal(model.measures.length, 80);
  model.setFret(0, 0, 1, 7);
  const clip = copyNotes(model, 0, 0);
  pasteNotes(model, 1, clip);
  assert.equal(model.tone(1, 0, 1).fret, 7);
  assert.equal(partXML(model, 0), original);
  const roundtrip = new ScoreDocument(model.serialize(), id);
  assert.equal(roundtrip.partIndex, 1); assert.equal(roundtrip.tone(1, 0, 1).fret, 7);
  roundtrip.selectPart(roundtrip.partInfos[0].id); assert.equal(partXML(roundtrip, 0), original);
});
test("bar, meter and tempo changes remain aligned across instruments", () => {
  const model = new ScoreDocument(sample);
  model.addPart("Guitar", guitar);
  model.insertMeasure(1);
  model.setTimeSignature(1, 3, 4);
  model.setTempo(1, 90);
  const map = JSON.stringify(model.tempoMap);
  for (const { id } of model.partInfos) {
    model.selectPart(id);
    assert.equal(model.measures.length, 81);
    assert.equal(model.measures[1].length, 3);
    assert.equal(JSON.stringify(model.tempoMap), map);
    assert.equal(model.measures[2].length, 4);
  }
  model.removeMeasure(1);
  for (const { id } of model.partInfos) { model.selectPart(id); assert.equal(model.measures.length, 80); }
});
test("conductor tempo map is independent of active instrument and rejected global edits are atomic", () => {
  const model = new ScoreDocument(sample);
  model.setTempo(2, 85);
  const expected = JSON.stringify(model.tempoMap);
  model.addPart("Guitar", guitar);
  assert.equal(JSON.stringify(model.tempoMap), expected);
  // Simulate an imported multi-voice instrument unsupported by the editor.
  const backup = model.doc.createElement("backup");
  model.parts[0].getElementsByTagName("measure")[0].appendChild(backup);
  const before = model.serialize(), active = model.activePartId;
  assert.throws(() => model.insertMeasure(1));
  assert.equal(model.serialize(), before); assert.equal(model.activePartId, active);
});
test("all imported instruments render; non-string instruments do not acquire TAB", () => {
  const model = new ScoreDocument(sample);
  model.addPart("Guitar", guitar);
  const score = alpha.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(model.serialize()), new alpha.Settings());
  score.tracks[1].staves[0].stringTuning.tunings = [];
  const active = model.activePartId;
  applyDisplaySettings(score, model);
  assert.equal(score.tracks.length, 2);
  assert.equal(score.tracks[0].staves[0].showTablature, true);
  assert.equal(score.tracks[1].staves[0].showTablature, false);
  assert.equal(model.activePartId, active);
});
