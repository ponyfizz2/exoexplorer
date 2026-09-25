/**
 * A physically-motivated 3D starfield for the WebGL scenes, plus the Milky Way
 * band. Distances are log-scaled: the nearest star is ~1.3 pc and the far wall of
 * the galaxy is ~30 kpc, so a linear mapping would collapse everything to a dot.
 */

import * as THREE from "three";
import { starColorFor } from "./planetTextures";

export interface NearbyStar { name: string; x: number; y: number; z: number; teff: number; mag: number }

/**
 * Twenty-five real stars within 15 parsecs, with approximate galactic
 * coordinates (x toward the galactic centre, y along the disk, z out of plane).
 * These anchor the map in something recognisable.
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
  { name: "Kapteyn's Star", x: -7.10, y: 16.40, z: -6.20, teff: 3570, mag: 8.86 },
];

/** Builds the background star sphere plus a Milky Way band. */
export function buildGalacticBackdrop(): THREE.Group {
  const group = new THREE.Group();
  group.name = "galactic-backdrop";

  // --- Star sphere --------------------------------------------------------
  const count = 9000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    // Cluster half the stars toward the galactic plane for a believable sky.
    const inPlane = i % 2 === 0;
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const phi = inPlane ? (Math.random() - 0.5) * 0.55 : Math.acos(u);
    // Far enough out that the camera can never fly past it, and scaled so the
    // points stay visible at the default orbit distance.
    const r = 1120 + Math.random() * 380;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * (inPlane ? 0.35 : 1);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const teff = 2600 + Math.pow(Math.random(), 1.8) * 22000;
    color.set(starColorFor(teff));
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    sizes[i] = 0.9 + Math.pow(Math.random(), 3) * 3.4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * (760.0 / -mv.z), 1.0, 7.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float dist = length(d);
        if (dist > 0.5) discard;
        float glow = pow(1.0 - dist * 2.0, 2.4);
        gl_FragColor = vec4(vColor, glow);
      }
    `,
    vertexColors: true,
  });

  const stars = new THREE.Points(geometry, material);
  stars.name = "star-sphere";
  group.add(stars);

  // --- Milky Way band -----------------------------------------------------
  const bandCount = 2600;
  const bandPos = new Float32Array(bandCount * 3);
  const bandCol = new Float32Array(bandCount * 3);
  for (let i = 0; i < bandCount; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const spread = (Math.random() - 0.5) * 92 * Math.pow(Math.random(), 0.6);
    const r = 1040 + Math.random() * 200;
    bandPos[i * 3] = Math.cos(theta) * r;
    bandPos[i * 3 + 1] = spread;
    bandPos[i * 3 + 2] = Math.sin(theta) * r;
    const warm = Math.random();
    bandCol[i * 3] = 0.9 + warm * 0.1;
    bandCol[i * 3 + 1] = 0.85 + warm * 0.1;
    bandCol[i * 3 + 2] = 0.95;
  }
  const bandGeo = new THREE.BufferGeometry();
  bandGeo.setAttribute("position", new THREE.BufferAttribute(bandPos, 3));
  bandGeo.setAttribute("color", new THREE.BufferAttribute(bandCol, 3));
  const bandMat = new THREE.PointsMaterial({
    size: 6.4, sizeAttenuation: true, transparent: true, opacity: 0.32,
    depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
  });
  const band = new THREE.Points(bandGeo, bandMat);
  band.name = "milky-way";
  group.add(band);

  // --- Nearby, named stars ------------------------------------------------
  const nearbyGeo = new THREE.BufferGeometry();
  const nearbyPos = new Float32Array(NEARBY_STARS.length * 3);
  const nearbyCol = new Float32Array(NEARBY_STARS.length * 3);
  NEARBY_STARS.forEach((star, i) => {
    // Local bubble coordinates are in parsecs; the map uses 1 unit = 1 parsec.
    nearbyPos[i * 3] = star.x;
    nearbyPos[i * 3 + 1] = star.z;
    nearbyPos[i * 3 + 2] = star.y;
    const c = new THREE.Color(starColorFor(star.teff));
    const brightness = Math.max(0.25, 1.15 - star.mag / 16);
    nearbyCol[i * 3] = c.r * brightness;
    nearbyCol[i * 3 + 1] = c.g * brightness;
    nearbyCol[i * 3 + 2] = c.b * brightness;
  });
  nearbyGeo.setAttribute("position", new THREE.BufferAttribute(nearbyPos, 3));
  nearbyGeo.setAttribute("color", new THREE.BufferAttribute(nearbyCol, 3));
  const nearby = new THREE.Points(nearbyGeo, new THREE.PointsMaterial({
    size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
  }));
  nearby.name = "nearby-stars";
  group.add(nearby);

  return group;
}
