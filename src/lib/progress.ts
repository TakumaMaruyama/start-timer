export const MAX_TOTAL_STROKES = 99;
export const MAX_COURSE_SWIMMERS = 99;
export const INITIAL_START_COUNTDOWN_MS = 10_000;

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

export function isValidCourseSwimmers(value: number | null) {
  return (
    value === null ||
    (Number.isInteger(value) && value >= 1 && value <= MAX_COURSE_SWIMMERS)
  );
}

/** Adjust the optional course size while keeping it within the supported range. */
export function adjustCourseSwimmers(
  currentCount: number | null,
  delta: number,
): number | null {
  const nextCount = (currentCount ?? 0) + delta;
  if (nextCount < 0 || nextCount > MAX_COURSE_SWIMMERS) {
    return currentCount;
  }
  return nextCount === 0 ? null : nextCount;
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

export type StartToneSchedule = {
  firstStartAtPerformanceMs: number;
  intervalMs: number;
  practiceCycleDurationMs: number | null;
  courseSwimmers: number | null;
  completionAtPerformanceMs: number;
};

/**
 * Return the next allowed start tone on or after `fromPerformanceMs`.
 * When a course size is configured, each practice cycle starts a fresh
 * interval sequence and is capped at that number of tones.
 */
export function nextStartToneAtOrAfter(
  fromPerformanceMs: number,
  schedule: StartToneSchedule,
): number | null {
  const {
    firstStartAtPerformanceMs,
    intervalMs,
    practiceCycleDurationMs,
    courseSwimmers,
    completionAtPerformanceMs,
  } = schedule;

  if (
    !Number.isFinite(fromPerformanceMs) ||
    !Number.isFinite(firstStartAtPerformanceMs) ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0 ||
    Number.isNaN(completionAtPerformanceMs)
  ) {
    return null;
  }

  const effectiveFrom = Math.max(
    fromPerformanceMs,
    firstStartAtPerformanceMs,
  );
  let nextStartAt: number;

  if (courseSwimmers === null) {
    const intervalIndex = Math.ceil(
      (effectiveFrom - firstStartAtPerformanceMs) / intervalMs,
    );
    nextStartAt =
      firstStartAtPerformanceMs + intervalIndex * intervalMs;
  } else {
    if (
      !isValidCourseSwimmers(courseSwimmers) ||
      practiceCycleDurationMs === null ||
      !Number.isFinite(practiceCycleDurationMs) ||
      practiceCycleDurationMs <= 0
    ) {
      return null;
    }

    const cycleIndex = Math.floor(
      (effectiveFrom - firstStartAtPerformanceMs) /
        practiceCycleDurationMs,
    );
    const cycleStartAt =
      firstStartAtPerformanceMs + cycleIndex * practiceCycleDurationMs;
    const intervalIndex = Math.ceil(
      (effectiveFrom - cycleStartAt) / intervalMs,
    );
    const offsetWithinCycle = intervalIndex * intervalMs;

    nextStartAt =
      intervalIndex < courseSwimmers &&
      offsetWithinCycle < practiceCycleDurationMs
        ? cycleStartAt + offsetWithinCycle
        : cycleStartAt + practiceCycleDurationMs;
  }

  return nextStartAt < completionAtPerformanceMs
    ? nextStartAt
    : null;
}
