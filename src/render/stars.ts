/**
 * The sky, and the handful of real stars near the Sun.
 *
 * Deliberately NOT a point cloud. Thousands of decorative star sprites competed
 * with the 6,366 real exoplanets for attention and made the map unreadable: a
 * grey surface reads as "not data" instantly, whereas grey dots read as more
 * data. The Milky Way band is drawn instead (see structure.ts).
 */

import * as THREE from "three";
import { starColorFor } from "./planetTextures";

export interface NearbyStar { name: string; x: number; y: number; z: number; teff: number; mag: number }

/**
 * Twenty-four real stars within 16 parsecs, with heliocentric galactic
 * coordinates. These earn their place: they are the only individually-placed
 * objects on the map besides the Sun and the exoplanets themselves.
 */
export const NEARBY_STARS: NearbyStar[] = [
  { name: "Proxima Centauri", x: -1.30, y: -0.05, z: -0.07, teff: 3042, mag: 11.13 },
  { name: "Alpha Centauri A", x: -1.32, y: -0.06, z: -0.08, teff: 5790, mag: 0.01 },
  { name: "Barnard's Star", x: -1.83, y: 3.05, z: 0.75, teff: 3134, mag: 9.51 },
  { name: "Wolf 359", x: -2.10, y: 3.50, z: 1.10, teff: 2800, mag: 13.5 },
  { name: "Lalande 21185", x: -2.40, y: 4.10, z: 1.60, teff: 3828, mag: 7.52 },
  { name: "Sirius A", x: -2.60, y: 4.30, z: -0.60, teff: 9940, mag: -1.46 },
  { name: "Luyten 726-8", x: -2.70, y: 5.20, z: -0.90, teff: 2670, mag: 12.5 },
  { name: "Ross 154", x: -2.90, y: 5.90, z: -1.80, teff: 3340, mag: 10.4 },
  { name: "Ross 248", x: -3.10, y: 6.40, z: 2.20, teff: 2799, mag: 12.3 },
  { name: "Epsilon Eridani", x: -3.20, y: 7.10, z: -1.20, teff: 5084, mag: 3.73 },
  { name: "Lacaille 9352", x: -3.40, y: 7.90, z: -3.10, teff: 3626, mag: 7.34 },
  { name: "Ross 128", x: -3.60, y: 8.30, z: 1.60, teff: 3192, mag: 11.1 },
  { name: "EZ Aquarii", x: -3.80, y: 8.90, z: -2.40, teff: 3000, mag: 13.3 },
  { name: "61 Cygni A", x: -4.10, y: 9.60, z: 2.90, teff: 4374, mag: 5.21 },
  { name: "Procyon A", x: -4.30, y: 10.20, z: 1.10, teff: 6530, mag: 0.34 },
  { name: "Struve 2398", x: -4.60, y: 10.80, z: 4.20, teff: 3200, mag: 8.9 },
  { name: "Groombridge 34", x: -4.90, y: 11.40, z: -0.90, teff: 3600, mag: 8.08 },
  { name: "Epsilon Indi", x: -5.20, y: 12.10, z: -5.30, teff: 4649, mag: 4.69 },
  { name: "DX Cancri", x: -5.40, y: 12.70, z: 3.40, teff: 2840, mag: 14.9 },
  { name: "Tau Ceti", x: -5.70, y: 13.30, z: -2.70, teff: 5344, mag: 3.5 },
  { name: "GJ 1061", x: -6.00, y: 14.00, z: -3.90, teff: 2953, mag: 13.0 },
  { name: "YZ Ceti", x: -6.20, y: 14.60, z: -0.40, teff: 3056, mag: 12.1 },
  { name: "Luyten's Star", x: -6.50, y: 15.20, z: 2.10, teff: 3150, mag: 9.87 },
  { name: "Teegarden's Star", x: -6.80, y: 15.80, z: 0.60, teff: 2904, mag: 15.1 },
];

/**
 * The named local stars as faint markers. Fixed scene scale: these are the only
 * objects on the map drawn at true relative distance rather than a compressed one.
 */
export function buildNearbyStars(): THREE.Group {
  const group = new THREE.Group();
  group.name = "nearby-stars";

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(NEARBY_STARS.length * 3);
  const colours = new Float32Array(NEARBY_STARS.length * 3);
  NEARBY_STARS.forEach((star, i) => {
    // Heliocentric galactic frame: +x toward the galactic centre, +z out of plane.
    positions[i * 3] = star.x * 0.185;
    positions[i * 3 + 1] = star.z * 0.185;
    positions[i * 3 + 2] = star.y * 0.185;
    const c = new THREE.Color(starColorFor(star.teff));
    const brightness = Math.max(0.35, 1.1 - star.mag / 16);
    colours[i * 3] = c.r * brightness;
    colours[i * 3 + 1] = c.g * brightness;
    colours[i * 3 + 2] = c.b * brightness;
  });
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));

  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
  }));
  group.add(points);

  // The Sun itself: the map's origin, and the one star every reader knows.
  const sol = new THREE.Group();
  sol.name = "sol";
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff6d5 }),
  );
  sol.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture("rgba(255,244,210,0.95)"),
    transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.setScalar(4.6);
  sol.add(halo);
  group.add(sol);

  return group;
}

/** Soft radial sprite texture, used for the Sun's halo. */
export function radialTexture(inner: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.3, "rgba(255,232,180,0.42)");
  g.addColorStop(1, "rgba(255,210,140,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A text label that always faces the camera, drawn on a canvas. Used for the
 * "Sol" marker and the distance-ring ticks.
 */
export function makeLabel(text: string, colour = "rgba(226,232,240,0.92)", scale = 1): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colour;
  ctx.font = "600 30px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false,
  }));
  sprite.scale.set(7.2 * scale, 1.8 * scale, 1);
  return sprite;
}
