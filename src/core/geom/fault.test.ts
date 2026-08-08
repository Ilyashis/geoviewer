import { describe, it, expect } from 'vitest';
import { sideOfPolyline, sameFaultBlock, estimateThrow } from './fault';

const vertical = [{ x: 5, y: -10 }, { x: 5, y: 10 }]; // straight fault along x=5

describe('sideOfPolyline', () => {
  it('gives opposite signs on either side of a straight trace', () => {
    const left = sideOfPolyline({ x: 0, y: 0 }, vertical);
    const right = sideOfPolyline({ x: 10, y: 0 }, vertical);
    expect(Math.sign(left)).not.toBe(Math.sign(right));
    expect(left).not.toBe(0);
    expect(right).not.toBe(0);
  });

  it('uses the nearest segment for a multi-segment (bent) trace', () => {
    const bent = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    // Near the vertical leg: same behaviour as a lone vertical segment there.
    const a = sideOfPolyline({ x: 8, y: 8 }, bent);
    const b = sideOfPolyline({ x: 12, y: 8 }, bent);
    expect(Math.sign(a)).not.toBe(Math.sign(b));
  });

  it('returns 0 for a degenerate (single-point) trace', () => {
    expect(sideOfPolyline({ x: 1, y: 1 }, [{ x: 0, y: 0 }])).toBe(0);
  });
});

describe('sameFaultBlock', () => {
  it('is false for points straddling a fault, true for points on the same side', () => {
    expect(sameFaultBlock({ x: 0, y: 0 }, { x: 10, y: 0 }, [vertical])).toBe(false);
    expect(sameFaultBlock({ x: 0, y: 0 }, { x: 1, y: 5 }, [vertical])).toBe(true);
  });

  it('requires agreement across every fault when several are given', () => {
    const horizontal = [{ x: -10, y: 5 }, { x: 10, y: 5 }];
    // Same side of `vertical`, but opposite sides of `horizontal`.
    expect(sameFaultBlock({ x: 0, y: 0 }, { x: 0, y: 10 }, [vertical, horizontal])).toBe(false);
    expect(sameFaultBlock({ x: 0, y: 0 }, { x: 0, y: 10 }, [vertical])).toBe(true);
  });

  it('never excludes a point exactly on the trace', () => {
    expect(sameFaultBlock({ x: 5, y: 0 }, { x: 10, y: 0 }, [vertical])).toBe(true);
  });
});

describe('estimateThrow', () => {
  it('recovers a known offset between two flat sides', () => {
    const points = [
      { x: 0, y: -5, z: 2000 }, { x: 0, y: 5, z: 2000 },   // left side, flat at 2000
      { x: 10, y: -5, z: 2050 }, { x: 10, y: 5, z: 2050 }, // right side, flat at 2050
    ];
    const t = estimateThrow(vertical, points);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(50, 0);
  });

  it('returns null when one side has no control points', () => {
    const points = [{ x: 0, y: -5, z: 2000 }, { x: 0, y: 5, z: 2000 }];
    expect(estimateThrow(vertical, points)).toBeNull();
  });

  it('returns null for a degenerate trace', () => {
    expect(estimateThrow([{ x: 0, y: 0 }], [{ x: 1, y: 1, z: 100 }])).toBeNull();
  });
});
