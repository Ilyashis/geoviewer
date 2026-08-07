import { describe, it, expect } from 'vitest';
import { segmentIntersection } from './intersect';

describe('segmentIntersection', () => {
  it('finds the crossing of a horizontal and a vertical segment', () => {
    const r = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(5, 6);
    expect(r!.y).toBeCloseTo(0, 6);
    expect(r!.fa).toBeCloseTo(0.5, 6); // halfway along the horizontal segment
    expect(r!.fb).toBeCloseTo(0.5, 6); // halfway along the vertical segment
  });

  it('finds an off-centre crossing at the correct fractional positions', () => {
    const r = segmentIntersection({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 20, y: -50 }, { x: 20, y: 50 });
    expect(r!.x).toBeCloseTo(20, 6);
    expect(r!.fa).toBeCloseTo(0.2, 6);
    expect(r!.fb).toBeCloseTo(0.5, 6);
  });

  it('returns null when the segments are parallel', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBeNull();
  });

  it('returns null when the lines would cross outside one of the segments', () => {
    // Same infinite lines as the first test, but segment B stops short of y=0.
    const r = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 5 });
    expect(r).toBeNull();
  });
});
