export const MAX_PRACTICE_CYCLE_SECONDS = 99 * 60 + 59;

/** Adjust a cycle duration while keeping it within the supported range. */
export function adjustPracticeCycleSeconds(
  currentSeconds: number | null,
  deltaSeconds: number,
): number | null {
  const nextSeconds = (currentSeconds ?? 0) + deltaSeconds;
  if (nextSeconds < 0 || nextSeconds > MAX_PRACTICE_CYCLE_SECONDS) {
    return currentSeconds;
  }
  return nextSeconds === 0 ? null : nextSeconds;
}
