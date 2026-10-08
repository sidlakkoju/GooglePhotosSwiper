// Times are in seconds. Handles cannot cross or produce an empty clip.
export function trimSelection(duration, start = 0, end = duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw Error('Video duration is unavailable.');
  const minimum = Math.min(0.5, duration);
  const bounded = (value, low, high) => {
    if (!Number.isFinite(value)) throw Error('Invalid trim time.');
    return Math.min(high, Math.max(low, value));
  };
  let left = bounded(start, 0, duration - minimum);
  let right = bounded(end, left + minimum, duration);
  return {
    get start() { return left; },
    get end() { return right; },
    get duration() { return right - left; },
    get changed() { return left > 0.001 || right < duration - 0.001; },
    moveStart(value) { left = bounded(value, 0, right - minimum); return left; },
    moveEnd(value) { right = bounded(value, left + minimum, duration); return right; },
    playbackTime(time) {
      if (!Number.isFinite(time) || time < left || time >= right) return left;
      return time;
    },
    snapshot() { return {start: left, end: right, duration: right - left}; }
  };
}
