import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustCourseSwimmers,
  adjustTotalStrokes,
  INITIAL_START_COUNTDOWN_MS,
  MAX_TOTAL_STROKES,
  nextStartToneAtOrAfter,
  practiceCycleStatusAt,
} from './progress.ts';

test('allows ten seconds to prepare before the initial start', () => {
  assert.equal(INITIAL_START_COUNTDOWN_MS, 10_000);
});

test('adjusts a configured total by one or five', () => {
  assert.equal(adjustTotalStrokes(10, -5), 5);
  assert.equal(adjustTotalStrokes(10, -1), 9);
  assert.equal(adjustTotalStrokes(10, 1), 11);
  assert.equal(adjustTotalStrokes(10, 5), 15);
});

test('starts an unset total from the selected positive step', () => {
  assert.equal(adjustTotalStrokes(null, 1), 1);
  assert.equal(adjustTotalStrokes(null, 5), 5);
});

test('turns zero into an unset total', () => {
  assert.equal(adjustTotalStrokes(1, -1), null);
  assert.equal(adjustTotalStrokes(5, -5), null);
});

test('keeps out-of-range adjustments unchanged', () => {
  assert.equal(adjustTotalStrokes(4, -5), 4);
  assert.equal(
    adjustTotalStrokes(MAX_TOTAL_STROKES - 4, 5),
    MAX_TOTAL_STROKES - 4,
  );
});

test('reports the next practice-cycle start from absolute times', () => {
  assert.deepEqual(practiceCycleStatusAt(1_000, 1_000, 60_000, 4), {
    currentCycleNumber: 1,
    nextCycleNumber: 2,
    remainingMs: 60_000,
  });
  assert.deepEqual(practiceCycleStatusAt(31_000, 1_000, 60_000, 4), {
    currentCycleNumber: 1,
    nextCycleNumber: 2,
    remainingMs: 30_000,
  });
});

test('advances without accumulating delayed-frame drift', () => {
  assert.deepEqual(practiceCycleStatusAt(126_000, 1_000, 60_000, 4), {
    currentCycleNumber: 3,
    nextCycleNumber: 4,
    remainingMs: 55_000,
  });
});

test('counts the final cycle down to practice completion', () => {
  assert.deepEqual(practiceCycleStatusAt(121_000, 1_000, 60_000, 3), {
    currentCycleNumber: 3,
    nextCycleNumber: null,
    remainingMs: 60_000,
  });
  assert.deepEqual(practiceCycleStatusAt(181_000, 1_000, 60_000, 3), {
    currentCycleNumber: 3,
    nextCycleNumber: null,
    remainingMs: 0,
  });
});

test('rejects invalid practice-cycle progress inputs', () => {
  assert.equal(practiceCycleStatusAt(1_000, 1_000, 0, 3), null);
  assert.equal(practiceCycleStatusAt(1_000, 1_000, 60_000, 0), null);
});

test('adjusts an optional course size by one or five', () => {
  assert.equal(adjustCourseSwimmers(null, 1), 1);
  assert.equal(adjustCourseSwimmers(1, 5), 6);
  assert.equal(adjustCourseSwimmers(6, -5), 1);
  assert.equal(adjustCourseSwimmers(1, -1), null);
});

const cappedSchedule = {
  firstStartAtPerformanceMs: 1_000,
  intervalMs: 10_000,
  practiceCycleDurationMs: 60_000,
  courseSwimmers: 5,
  completionAtPerformanceMs: 181_000,
};

test('limits start tones to the course size within each practice cycle', () => {
  assert.equal(nextStartToneAtOrAfter(1_000, cappedSchedule), 1_000);
  assert.equal(nextStartToneAtOrAfter(1_001, cappedSchedule), 11_000);
  assert.equal(nextStartToneAtOrAfter(41_001, cappedSchedule), 61_000);
  assert.equal(nextStartToneAtOrAfter(61_001, cappedSchedule), 71_000);
});

test('keeps exact practice-cycle boundaries available only once', () => {
  assert.equal(nextStartToneAtOrAfter(60_999, cappedSchedule), 61_000);
  assert.equal(nextStartToneAtOrAfter(61_000, cappedSchedule), 61_000);
  assert.equal(nextStartToneAtOrAfter(61_001, cappedSchedule), 71_000);
});

test('with one swimmer, skips directly to the next practice cycle', () => {
  const oneSwimmerSchedule = {
    ...cappedSchedule,
    courseSwimmers: 1,
  };
  assert.equal(
    nextStartToneAtOrAfter(1_001, oneSwimmerSchedule),
    61_000,
  );
  assert.equal(
    nextStartToneAtOrAfter(61_001, oneSwimmerSchedule),
    121_000,
  );
});

test('starts the next cycle on its absolute boundary without drift', () => {
  assert.equal(nextStartToneAtOrAfter(55_000, cappedSchedule), 61_000);
  assert.equal(nextStartToneAtOrAfter(126_000, cappedSchedule), 131_000);
});

test('uses fewer tones when a cycle is shorter than the requested course size', () => {
  const shortCycleSchedule = {
    ...cappedSchedule,
    practiceCycleDurationMs: 25_000,
    completionAtPerformanceMs: 76_000,
  };
  assert.equal(
    nextStartToneAtOrAfter(21_001, shortCycleSchedule),
    26_000,
  );
});

test('starts each new cycle when the interval is longer than the cycle', () => {
  const veryShortCycleSchedule = {
    ...cappedSchedule,
    practiceCycleDurationMs: 5_000,
    completionAtPerformanceMs: 16_000,
  };
  assert.equal(
    nextStartToneAtOrAfter(1_001, veryShortCycleSchedule),
    6_000,
  );
  assert.equal(
    nextStartToneAtOrAfter(6_001, veryShortCycleSchedule),
    11_000,
  );
});

test('does not schedule a tone at or after practice completion', () => {
  assert.equal(
    nextStartToneAtOrAfter(121_001, {
      ...cappedSchedule,
      completionAtPerformanceMs: 121_000,
    }),
    null,
  );
});

test('keeps the existing unlimited absolute interval schedule', () => {
  assert.equal(
    nextStartToneAtOrAfter(26_000, {
      ...cappedSchedule,
      courseSwimmers: null,
    }),
    31_000,
  );
});
