import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustTotalStrokes,
  MAX_TOTAL_STROKES,
  practiceCycleStatusAt,
} from './progress.ts';

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
