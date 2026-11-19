import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NoteAudition } from "../public/note-audition.js";
const require = createRequire(import.meta.url);
Object.assign(globalThis, require("../vendor/xmldom/package/lib/index.js"));
const { ScoreDocument } = await import("../public/editor-model.js");

function context() {
  const nodes = [];
  return {
    nodes, state: "running", currentTime: 2, destination: {},
    createOscillator() {
      const node = { frequency: {}, stops: [], connect() {},
        disconnect() { this.disconnected = true; },
        start(t) { this.started = t; }, stop(t) { this.stops.push(t); } };
      nodes.push(node); return node;
    },
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} },
        connect() {}, disconnect() {} };
    },
  };
}
const closeTo = (a,b) => assert(Math.abs(a-b) < 1e-8, `${a} != ${b}`);

test("note-entry feedback uses the selected chord string and custom tuning, including grace notes", async () => {
  const score = new ScoreDocument(readFileSync(new URL("./fixtures/reference.musicxml", import.meta.url), "utf8"));
  score.setTuning(["A0", "E1", "A1", "D2", "G2"]);
  // A high string and a low string at the same position must audition separately.
  score.setFret(0, 0, 1, 2); score.setFret(0, 0, 5, 12);
  const ctx = context(), audition = new NoteAudition(() => ctx);
  const before = score.serialize();
  await audition.play(score.tone(0, 0, 1));
  closeTo(ctx.nodes.at(-1).frequency.value, 110); // A2
  await audition.play(score.tone(0, 0, 5));
  closeTo(ctx.nodes.at(-1).frequency.value, 55); // A1, custom low-string tuning
  assert.equal(score.serialize(), before);
  score.addGrace(0, 0, 5); score.setFret(0, 0, 5, 0);
  await audition.play(score.tone(0, 0, 5));
  closeTo(ctx.nodes.at(-1).frequency.value, 27.5); // A0
  assert.equal(score.event(0, 0).duration, 0);
  assert(ctx.nodes.at(-1).stops[0] > ctx.nodes.at(-1).started);
  score.setTuning(["E2", "A2", "D3", "G3", "B3", "E4"]);
  score.setFret(0, 0, 1, 5);
  await audition.play(score.tone(0, 0, 1));
  closeTo(ctx.nodes.at(-1).frequency.value, 440); // Six-string guitar A4
});

test("two-digit entry replaces the provisional pitch and releases all voices", async () => {
  const ctx = context(), audition = new NoteAudition(() => ctx);
  await audition.play({ midi: 41 }); // E string fret 1
  const first = ctx.nodes[0];
  ctx.currentTime += 0.05;
  await audition.play({ midi: 52 }); // fret 12
  const second = ctx.nodes[1];
  closeTo(second.frequency.value, 164.81377845643496);
  assert(first.stops.at(-1) < first.stops[0]);
  first.onended();
  assert(first.disconnected);
  assert.equal(audition.voice.oscillator, second);
  second.onended();
  assert(second.disconnected);
  assert.equal(audition.voice, null);
});

test("pending audio unlock never plays a stale note after a newer entry or transport stop", async () => {
  const ctx = context(); ctx.state = "suspended";
  let unlock;
  const ready = new Promise(resolve => { unlock = resolve; });
  ctx.resume = () => ready;
  const audition = new NoteAudition(() => ctx);
  const first = audition.play({ midi: 41 }), second = audition.play({ midi: 52 });
  unlock();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(ctx.nodes.length, 1);
  audition.stop();
  const third = audition.play({ midi: 55 });
  audition.stop();
  assert.equal(await third, false);
  assert.equal(ctx.nodes.length, 1);
});

test("rests and invalid pitches stay silent; dead notes get a brief unpitched preview", async () => {
  const ctx = context(), audition = new NoteAudition(() => ctx);
  for (const tone of [null, {rest:true,midi:60}, {midi:NaN}, {midi:-1}, {midi:128}])
    assert.equal(await audition.play(tone), false);
  assert.equal(ctx.nodes.length, 0);
  await audition.play({ midi: 40, dead: true });
  assert.equal(ctx.nodes[0].frequency.value, 90);
  assert(ctx.nodes[0].stops[0] - ctx.nodes[0].started < 0.1);
});

test("audio failure is reported without changing the edited tone", async () => {
  const tone = Object.freeze({ midi: 69, fret: 5, string: 1 });
  const audition = new NoteAudition(() => ({ state:"suspended", resume:async()=>{throw Error("audio blocked");} }));
  await assert.rejects(audition.play(tone), /audio blocked/);
  assert.equal(tone.midi, 69);
  assert.equal(audition.voice, null);
});
