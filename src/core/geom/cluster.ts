/**
 * Grouping of scattered points into spatially connected clusters.
 *
 * A map is only meaningful over one field. Real drops mix them: a folder of
 * "one project" turned out to hold six groups of wells spread over 68 km, and
 * a saved project kept a stray demo well thousands of kilometres from the real
 * field. Gridding across such a set stretches the mesh over mostly nothing —
 * and since `idwGrid` now leaves unreachable cells blank, the result *looks*
 * broken without saying why. This is what lets the map say why.
 */

import { dataRadius, type ControlPoint } from './grid';

export interface Cluster {
  /** Indices into the input array. */
  members: number[];
  minX: number; maxX: number; minY: number; maxY: number;
}

/**
 * Single-linkage grouping: two points are in the same cluster when a chain of
 * hops no longer than `gap` connects them. Defaults to the same radius the
 * grid uses to decide reachability, so the warning and the blanking always
 * agree — a set that grids as one surface reports as one cluster.
 */
export function clusterPoints(points: ControlPoint[], gap = dataRadius(points)): Cluster[] {
  const n = points.length;
  const group = new Int32Array(n).fill(-1);
  const clusters: Cluster[] = [];
  if (!Number.isFinite(gap) || gap <= 0) {
    // No usable spacing (one point, or all coincident) — everything is one group.
    return n ? [bounds(points, [...points.keys()])] : [];
  }
  const g2 = gap * gap;

  for (let seed = 0; seed < n; seed++) {
    if (group[seed] !== -1) continue;
    const id = clusters.length;
    const members: number[] = [];
    const stack = [seed];
    group[seed] = id;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      for (let j = 0; j < n; j++) {
        if (group[j] !== -1) continue;
        const d2 = (points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2;
        if (d2 <= g2) { group[j] = id; stack.push(j); }
      }
    }
    clusters.push(bounds(points, members));
  }

  // Largest first: the main field leads, strays follow.
  return clusters.sort((a, b) => b.members.length - a.members.length);
}

function bounds(points: ControlPoint[], members: number[]): Cluster {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of members) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { members: members.sort((a, b) => a - b), minX, maxX, minY, maxY };
}

/** Shortest distance between the bounding boxes of two clusters, in metres. */
export function clusterGap(a: Cluster, b: Cluster): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}
