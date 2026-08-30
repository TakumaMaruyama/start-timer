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

export type PracticeCycleStatus = {
  currentCycleNumber: number;
  nextCycleNumber: number | null;
  remainingMs: number;
};

/**
 * Return progress within the configured practice cycle using absolute times.
 * The final cycle counts down to practice completion instead of another start.
 */
export function practiceCycleStatusAt(
  nowPerformanceMs: number,
  firstStartAtPerformanceMs: number,
  cycleDurationMs: number,
  totalCycles: number,
): PracticeCycleStatus | null {
  if (
    !Number.isFinite(nowPerformanceMs) ||
    !Number.isFinite(firstStartAtPerformanceMs) ||
    !Number.isFinite(cycleDurationMs) ||
    cycleDurationMs <= 0 ||
    !Number.isInteger(totalCycles) ||
    totalCycles < 1
  ) {
    return null;
  }

  const effectiveNow = Math.max(
    nowPerformanceMs,
    firstStartAtPerformanceMs,
  );
  const currentCycleNumber = Math.min(
    totalCycles,
    cycleNumberAt(
      effectiveNow,
      firstStartAtPerformanceMs,
      cycleDurationMs,
    ),
  );
  const nextBoundaryAt =
    firstStartAtPerformanceMs + currentCycleNumber * cycleDurationMs;

  return {
    currentCycleNumber,
    nextCycleNumber:
      currentCycleNumber < totalCycles
        ? currentCycleNumber + 1
        : null,
    remainingMs: Math.max(0, nextBoundaryAt - effectiveNow),
  };
}

export function shouldScheduleStartAt(
  startAtPerformanceMs: number,
  completionAtPerformanceMs: number,
) {
  return startAtPerformanceMs < completionAtPerformanceMs;
}
