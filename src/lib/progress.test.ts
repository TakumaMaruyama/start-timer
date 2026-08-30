import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustTotalStrokes,
  MAX_TOTAL_STROKES,
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
