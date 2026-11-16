// Interpolate in musical time, using actual engraved note positions.
// The caller converts MP3 time through the recording's synchronization map first.
export function playheadX(q, points) {
  if (!points.length) return null;
  const first = points[0], last = points.at(-1);
  if (q <= first.q) return first.x;
  if (q >= last.q) return last.x;
  const index = points.findIndex((point) => point.q > q);
  const left = points[index - 1], right = points[index];
  return left.x + (right.x - left.x) * (q - left.q) / (right.q - left.q);
}

// Frame-rate independent easing for a continuously moving scroll target.
// Scroll with immediate frame updates; repeated browser "smooth" requests restart
// their animation and cause the measure-by-measure tugging this avoids.
export function followScrollPosition(position, target, elapsedSeconds) {
  const dt = Math.max(0, Math.min(0.05, elapsedSeconds));
  return position + (target - position) * (1 - Math.exp(-dt / 0.085));
}
