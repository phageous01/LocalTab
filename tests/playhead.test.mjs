import { test } from "node:test";
import assert from "node:assert/strict";
import { playheadX, followScrollPosition } from "../public/playhead.js";
test("playhead uses musical duration between actual engraving positions", () => {
  const points = [{ q: 0, x: 20 }, { q: 1.5, x: 100 }, { q: 2, x: 160 }, { q: 4, x: 220 }];
  assert.equal(playheadX(0.75, points), 60);
  assert.equal(playheadX(1.75, points), 130);
  assert.equal(playheadX(3, points), 190);
  assert.equal(playheadX(-1, points), 20);
  assert.equal(playheadX(5, points), 220);
  assert.equal(playheadX(1, []), null);
  assert.equal(playheadX(1, [{ q: 0, x: 10 }]), 10);
});
test("continuous following eases toward its target independently of frame rate", () => {
  function follow(frames) {
    let x = 0;
    for (let i = 0; i < frames; i++) x = followScrollPosition(x, 100, 1 / frames);
    return x;
  }
  assert(Math.abs(follow(60) - follow(120)) < 1e-9);
  assert(followScrollPosition(0, 100, 1 / 60) > 0);
  assert(followScrollPosition(0, 100, 1 / 60) < 25);
  assert.equal(followScrollPosition(20, 100, 0), 20);
  assert.equal(followScrollPosition(0, 100, 2), followScrollPosition(0, 100, 0.05));
  let x = 0;
  for (let i = 1; i <= 120; i++) {
    const next = followScrollPosition(x, i * 2, 1 / 60);
    assert(next >= x && next - x < 3); // No measure-boundary jumps.
    x = next;
  }
});
