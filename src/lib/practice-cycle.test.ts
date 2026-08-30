import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustPracticeCycleSeconds,
  MAX_PRACTICE_CYCLE_SECONDS,
} from './practice-cycle.ts';

test('normalizes seconds across minute boundaries', () => {
  assert.equal(adjustPracticeCycleSeconds(55, 10), 65);
  assert.equal(adjustPracticeCycleSeconds(65, -10), 55);
});

test('turns zero into an unset cycle', () => {
  assert.equal(adjustPracticeCycleSeconds(10, -10), null);
  assert.equal(adjustPracticeCycleSeconds(null, 0), null);
});

test('keeps out-of-range adjustments unchanged', () => {
  assert.equal(adjustPracticeCycleSeconds(0, -5), 0);
  assert.equal(
    adjustPracticeCycleSeconds(MAX_PRACTICE_CYCLE_SECONDS, 5),
    MAX_PRACTICE_CYCLE_SECONDS,
  );
});
