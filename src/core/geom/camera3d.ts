/**
 * Orbit camera and perspective projection for the 3D scene.
 *
 * Kept as pure maths in the kernel so the renderer stays a thin drawing layer
 * and the projection itself can be tested without a canvas.
 *
 * World axes follow the rest of the app: x east, y north, z up — so z is TVDSS,
 * negative below sea level. Screen axes are the canvas ones: x right, y down.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Camera {
  /** Compass rotation of the eye about the target, radians (0 = looking north). */
  azimuth: number;
  /** Eye height above the horizontal plane, radians (π/2 = straight down). */
  elevation: number;
  /** Eye-to-target distance, in world units. */
  distance: number;
  target: Vec3;
  /**
   * Vertical exaggeration. Structural relief is tens of metres across
   * kilometres of field, so at true scale every surface is a flat sheet and the
   * scene shows nothing. Exaggeration is what makes the structure visible, and
   * it is a display choice — never applied to the numbers.
   */
  vScale: number;
  width: number;
  height: number;
  /** Focal length in pixels; larger is a longer lens (less perspective). */
  focal: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Distance in front of the eye; larger is further away. */
  depth: number;
  /** False when the point is behind the eye and must not be drawn. */
  visible: boolean;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Where the eye sits for this camera. */
export function eyeOf(c: Camera): Vec3 {
  const ce = Math.cos(c.elevation), se = Math.sin(c.elevation);
  return {
    x: c.target.x + c.distance * ce * Math.sin(c.azimuth),
    y: c.target.y + c.distance * ce * Math.cos(c.azimuth),
    z: c.target.z * c.vScale + c.distance * se,
  };
}

export interface Basis { eye: Vec3; right: Vec3; up: Vec3; forward: Vec3 }

/**
 * The camera's orthonormal frame. Built once per render rather than per point:
 * a surface is tens of thousands of vertices.
 */
export function basisOf(c: Camera): Basis {
  const eye = eyeOf(c);
  const scaledTarget = { x: c.target.x, y: c.target.y, z: c.target.z * c.vScale };
  const forward = norm(sub(scaledTarget, eye));
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 };
  // Looking straight down leaves `forward` parallel to up; fall back to north.
  const r = cross(forward, worldUp);
  const right = Math.hypot(r.x, r.y, r.z) < 1e-9
    ? norm(cross(forward, { x: 0, y: 1, z: 0 }))
    : norm(r);
  const up = cross(right, forward);
  return { eye, right, up, forward };
}

/** Project a world point to screen pixels through a prepared basis. */
export function projectWith(c: Camera, b: Basis, p: Vec3): Projected {
  const v = sub({ x: p.x, y: p.y, z: p.z * c.vScale }, b.eye);
  const depth = dot(v, b.forward);
  if (depth <= 1e-6) return { x: 0, y: 0, depth, visible: false };
  const s = c.focal / depth;
  return {
    x: c.width / 2 + dot(v, b.right) * s,
    y: c.height / 2 - dot(v, b.up) * s,
    depth,
    visible: true,
  };
}

/** Convenience for one-off points; builds the basis each call. */
export function project(c: Camera, p: Vec3): Projected {
  return projectWith(c, basisOf(c), p);
}

/**
 * A camera framing the given bounds. `focal` is chosen so the box fills the
 * viewport regardless of how large the field is — a 70 km field and a 4 km one
 * should both arrive framed.
 */
export function frameBounds(
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  width: number, height: number, vScale: number,
): Camera {
  const target: Vec3 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const spanZ = Math.max((bounds.maxZ - bounds.minZ) * vScale, 1);
  const radius = Math.hypot(spanX, spanY, spanZ) / 2;
  return {
    azimuth: Math.PI * 0.25,
    elevation: Math.PI * 0.22,
    distance: radius * 3.2,
    target, vScale, width, height,
    focal: Math.min(width, height) * 1.15,
  };
}
