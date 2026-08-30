export const MAX_TOTAL_STROKES = 99;

export function isValidTotalStrokes(value: number | null) {
  return (
    value === null ||
    (Number.isInteger(value) && value >= 1 && value <= MAX_TOTAL_STROKES)
  );
}

/** Adjust the optional total while keeping it within the supported range. */
export function adjustTotalStrokes(
  currentTotal: number | null,
  delta: number,
): number | null {
  const nextTotal = (currentTotal ?? 0) + delta;
  if (nextTotal < 0 || nextTotal > MAX_TOTAL_STROKES) {
    return currentTotal;
  }
  return nextTotal === 0 ? null : nextTotal;
}

export function isValidPracticeCycleSeconds(value: number | null) {
  return value !== null && Number.isInteger(value) && value > 0;
}

export function cycleNumberAt(
  startAtPerformanceMs: number,
  firstStartAtPerformanceMs: number,
  cycleDurationMs: number,
) {
  if (cycleDurationMs <= 0) return 1;
  return (
    Math.floor(
      Math.max(0, startAtPerformanceMs - firstStartAtPerformanceMs) /
        cycleDurationMs,
    ) + 1
  );
}

export function shouldScheduleStartAt(
  startAtPerformanceMs: number,
  completionAtPerformanceMs: number,
) {
  return startAtPerformanceMs < completionAtPerformanceMs;
}
