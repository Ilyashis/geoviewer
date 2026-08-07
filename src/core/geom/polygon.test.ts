import { describe, it, expect } from 'vitest';
import { pointInPolygon } from './polygon';

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('pointInPolygon', () => {
  it('is true for a point well inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('is false for a point well outside', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -5 }, square)).toBe(false);
  });

  it('handles a concave (L-shaped) polygon correctly', () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 2, y: 2 }, L)).toBe(true);  // inside the leg
    expect(pointInPolygon({ x: 8, y: 8 }, L)).toBe(false); // inside the notch, outside the L
  });

  it('does not require the caller to repeat the first point at the end', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 5 }, [...square, square[0]])).toBe(true);
  });
});
