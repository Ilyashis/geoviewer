/**
 * Framing maths for the 3D scene: where to put the camera so a model of any
 * size arrives on screen whole.
 *
 * The projection itself is three.js's job. What stays here is the part that is
 * about *this* data rather than about rendering — a field is anywhere from
 * four to seventy kilometres across, its relief is a couple of hundred metres,
 * and the vertical exaggeration that makes the relief visible also changes how
 * far away the camera has to stand.
 *
 * World axes follow the rest of the app: x east, y north, z up. Note that z is
 * *elevation*, not depth — `tvdss` is positive downwards, so callers negate it.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Bounds {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

export interface Framing {
  /** Point the camera looks at, in unexaggerated world units. */
  target: Vec3;
  /** Eye-to-target distance that fits the whole box in view. */
  distance: number;
}

/** Starting view: from the south-east, well above the horizontal. */
export const START_AZIMUTH = Math.PI * 0.25;
export const START_ELEVATION = Math.PI * 0.22;

/**
 * Frame a bounding box. `vScale` is the vertical exaggeration the scene will
 * apply, and it belongs in the distance: at ×40 a two-hundred-metre relief
 * becomes eight kilometres of model that has to fit on screen too.
 */
export function framingFor(bounds: Bounds, vScale: number): Framing {
  const target: Vec3 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const spanZ = Math.max((bounds.maxZ - bounds.minZ) * vScale, 1);
  const radius = Math.hypot(spanX, spanY, spanZ) / 2;
  return { target, distance: radius * 2.8 };
}

/** Eye position for a framing at the given orbit angles, with z exaggerated. */
export function eyeFor(f: Framing, vScale: number, azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  return {
    x: f.target.x + f.distance * ce * Math.sin(azimuth),
    y: f.target.y + f.distance * ce * Math.cos(azimuth),
    z: f.target.z * vScale + f.distance * se,
  };
}
