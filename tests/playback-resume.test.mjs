import { test } from "node:test";
import assert from "node:assert/strict";
import { PlaybackResume } from "../public/playback-resume.js";

function score(lengths = Array(30).fill(4)) {
  let q = 0;
  return { measures: lengths.map((length, index) => {
    const m = { el: {}, index, q, length }; q += length; return m;
  }), totalQ: lengths.reduce((sum, length) => sum + length, 0) };
}

test("space returns to measure 13 while the button resumes paused measure 23, repeatedly", () => {
  const s = score(), state = new PlaybackResume(); state.select(s, 12);
  for (const paused of [90.5, 91.75, 103, 90]) {
    assert.equal(state.position(s, paused, "practice"), 48);
    assert.equal(state.position(s, paused, "paused"), Math.floor(paused / 4) * 4);
    assert.equal(state.startMeasure, 12);
  }
});

test("all note and fractional positions resume at the containing measure's beginning", () => {
  const s = score(), state = new PlaybackResume();
  for (const q of [48, 48.25, 49, 49.5, 50, 50.5, 51.999])
    assert.equal(state.position(s, q), 48);
  assert.equal(state.position(s, 52), 52);
});

test("measure heads follow mixed meters rather than assuming four beats per bar", () => {
  const s = score([3,4,3,3.5]), state = new PlaybackResume();
  state.select(s, 2);
  assert.equal(state.position(s, 9.99), 7);
  assert.equal(state.position(s, 10), 10);
  assert.equal(state.position(s, 12, "practice"), 7);
});

test("speed changes and exact timeline seeks preserve their musical fraction and practice start", () => {
  const s = score(), state = new PlaybackResume(); state.select(s, 12);
  assert.equal(state.position(s, 90.375, "exact"), 90.375);
  assert.equal(state.position(s, 90.375, "practice"), 48);
  assert.equal(state.position(s, 90.375, "paused"), 88);
});

test("new scores default to measure one; end-of-score button resumes the last measure", () => {
  const s = score(), state = new PlaybackResume();
  assert.equal(state.position(s, 95, "practice"), 0);
  state.select(s, 12); state.reset();
  assert.equal(state.position(s, 95, "practice"), 0);
  assert.equal(state.position(s, s.totalQ), 116);
  assert.equal(state.position(s, s.totalQ + 50), 116);
  assert.equal(state.position(s, -1), 0);
});

test("insertions and deletions follow the original start measure with a nearby fallback", () => {
  const s = score([4,4,4,4]), state = new PlaybackResume(); state.select(s, 2);
  const previous = [...s.measures];
  s.measures.splice(0, 0, { el: {}, q: 0, length: 4 });
  s.measures.forEach((m,i)=>{m.index=i; m.q=i*4;}); s.totalQ=20;
  state.remap(previous, s);
  assert.equal(state.startMeasure, 3);
  const next = [...s.measures]; s.measures.splice(3, 1);
  s.measures.forEach((m,i)=>{m.index=i;m.q=i*4;}); s.totalQ=16;
  state.remap(next, s);
  assert.equal(state.startMeasure, 3);
  const last = [...s.measures]; s.measures.pop(); s.totalQ=12;
  state.remap(last, s);
  assert.equal(state.startMeasure, 2);
});
