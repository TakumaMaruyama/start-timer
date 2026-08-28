export function isValidTotalStrokes(value: number | null) {
  return (
    value === null ||
    (Number.isInteger(value) && value >= 1 && value <= 99)
  );
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