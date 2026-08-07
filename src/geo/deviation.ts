/**
 * Well trajectory from a deviation survey (minimum-curvature method).
 * Converts measured depth (MD) to true vertical depth (TVD) and horizontal
 * offset (north/east) from the wellhead — the basis for TVD-correct maps.
 */

export interface SurveyStation {
  md: number;
  /** Inclination from vertical, degrees (0 = vertical). */
  inc: number;
  /** Azimuth, degrees (0 = north, 90 = east). */
  azi: number;
}

export interface TrajPoint {
  md: number;
  tvd: number;
  north: number;
  east: number;
}

const DEG = Math.PI / 180;

/**
 * Minimum-curvature trajectory. Stations are sorted by MD; the hole is assumed
 * vertical above the first station. Returns cumulative TVD and N/E offsets.
 */
export function computeTrajectory(survey: SurveyStation[]): TrajPoint[] {
  const s = survey.filter((st) => Number.isFinite(st.md)).sort((a, b) => a.md - b.md);
  if (s.length === 0) return [];

  const traj: TrajPoint[] = [{ md: s[0].md, tvd: s[0].md, north: 0, east: 0 }];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    const dMD = b.md - a.md;
    if (dMD <= 0) continue;
    const i1 = a.inc * DEG, i2 = b.inc * DEG, a1 = a.azi * DEG, a2 = b.azi * DEG;
    let cosB = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
    cosB = Math.max(-1, Math.min(1, cosB));
    const beta = Math.acos(cosB);
    const rf = beta > 1e-9 ? (2 / beta) * Math.tan(beta / 2) : 1; // ratio factor
    const h = (dMD / 2) * rf;
    const p = traj[traj.length - 1];
    traj.push({
      md: b.md,
      tvd: p.tvd + h * (Math.cos(i1) + Math.cos(i2)),
      north: p.north + h * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2)),
      east: p.east + h * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2)),
    });
  }
  return traj;
}

/** Interpolate the trajectory at an arbitrary MD (vertical fallback if empty). */
export function positionAtMd(traj: TrajPoint[], md: number): { tvd: number; north: number; east: number } {
  const n = traj.length;
  if (n === 0) return { tvd: md, north: 0, east: 0 };
  if (n === 1 || md <= traj[0].md) {
    const p = traj[0];
    return { tvd: p.tvd + (md - p.md), north: p.north, east: p.east }; // vertical above first station
  }
  for (let i = 1; i < n; i++) {
    if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i], t = (md - a.md) / (b.md - a.md);
      return {
        tvd: a.tvd + (b.tvd - a.tvd) * t,
        north: a.north + (b.north - a.north) * t,
        east: a.east + (b.east - a.east) * t,
      };
    }
  }
  // Below TD: extrapolate along the last segment's tangent.
  const a = traj[n - 2], b = traj[n - 1], seg = b.md - a.md, k = seg > 0 ? (md - b.md) / seg : 0;
  return {
    tvd: b.tvd + (b.tvd - a.tvd) * k,
    north: b.north + (b.north - a.north) * k,
    east: b.east + (b.east - a.east) * k,
  };
}

/** TVD at a measured depth (vertical fallback if the survey is empty). */
export function tvdAtMd(traj: TrajPoint[], md: number): number {
  return positionAtMd(traj, md).tvd;
}
