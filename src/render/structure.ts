/**
 * Context layers for the 3D map: a schematic Milky Way and a set of distance
 * rings.
 *
 * IMPORTANT: none of this is data. The archive gives position, not a picture, so
 * the spiral is drawn from the standard four-arm logarithmic model purely to give
 * the eye something to navigate by. Real confirmed planets are drawn on top at
 * full brightness; everything here is deliberately faint.
 *
 * The Sun is placed 8.15 kpc from the galactic centre, which is why the spiral
 * centre sits far off to one side of the default (Sun-centred) view.
 */

import * as THREE from "three";

const SUN_GALACTOCENTRIC_PC = 8150;

/** Must match SCENE_EXTENT in galaxy.ts. */
const SCENE_EXTENT = 74;
const distanceToScene = (pc: number): number => {
  const d = Math.min(Math.max(pc, 1.3), 12000);
  return 0.9 + (Math.log10(d / 1.3) / Math.log10(12000 / 1.3)) * SCENE_EXTENT;
};

export interface StructureOptions {
  /** How far the map extends, in scene units, for the ring labels. */
  extent: number;
  portal: "local" | "galactic";
}

/** Four-arm logarithmic spiral with a central bulge, as a point cloud. */
export function buildGalacticStructure(): THREE.Group {
  const group = new THREE.Group();
  group.name = "galactic-structure";

  // The compressed scale maps 8,150 pc to roughly this many scene units.
  const centre = galacticCentreScene();
  const arms = 4;
  const pitch = 0.28; // radians; ~16 degrees, close to the observed Milky Way
  const perArm = 4200;
  const maxRadius = 132;

  const positions = new Float32Array(perArm * arms * 3);
  const colors = new Float32Array(perArm * arms * 3);
  let cursor = 0;
  const colour = new THREE.Color();

  const push = (x: number, y: number, z: number, tint: number, brightness: number) => {
    positions[cursor * 3] = x;
    positions[cursor * 3 + 1] = y;
    positions[cursor * 3 + 2] = z;
    colour.setHSL(tint, 0.42, 0.5);
    colors[cursor * 3] = colour.r * brightness;
    colors[cursor * 3 + 1] = colour.g * brightness;
    colors[cursor * 3 + 2] = colour.b * brightness;
    cursor += 1;
  };

  for (let arm = 0; arm < arms; arm += 1) {
    const armOffset = (arm / arms) * Math.PI * 2;
    for (let i = 0; i < perArm; i += 1) {
      // Bias toward the centre, where the density really is highest.
      const t = Math.pow(Math.random(), 0.62);
      const radius = 7.5 + t * maxRadius;
      const theta = armOffset + (radius / 16) * pitch * Math.PI;
      // Scatter perpendicular to the arm, widening with radius.
      const spread = 2.1 + (radius / maxRadius) * 9.4;
      const jitterR = (Math.random() - 0.5) * spread;
      const jitterT = (Math.random() - 0.5) * 0.22;
      const r = radius + jitterR;
      const a = theta + jitterT;
      const x = centre.x + Math.cos(a) * r;
      const z = centre.z + Math.sin(a) * r;
      // The disk is thin: 300 pc scale height versus a 15 kpc radius.
      const y = (Math.random() - 0.5) * (1.6 + (radius / maxRadius) * 1.9);
      const inner = radius < 26;
      push(x, y, z, inner ? 0.11 : 0.58, inner ? 0.5 : 0.34);
    }
  }

  // Central bulge.
  for (let i = 0; i < 2600; i += 1) {
    const r = Math.pow(Math.random(), 1.9) * 26;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    push(
      centre.x + r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) * 0.55 * 1.0,
      centre.z + r * Math.sin(phi) * Math.sin(theta),
      0.1, 0.62,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions.subarray(0, cursor * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors.subarray(0, cursor * 3), 3));

  const material = new THREE.PointsMaterial({
    size: 0.55,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "milky-way-schematic";
  group.add(points);

  // Bright galactic core, so the far side of the map has an anchor.
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture("rgba(255,240,210,0.85)"),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  core.position.set(centre.x, 0, centre.z);
  core.scale.setScalar(30);
  core.name = "galactic-core";
  group.add(core);

  return group;
}

/**
 * Distance rings, drawn with a label anchor. Both projections get their own
 * sensible spacing: linear light-year steps locally, decades on the log view.
 */
export function buildDistanceRings(portal: "local" | "galactic", toScene: (pc: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = "distance-rings";

  const steps = portal === "local"
    ? [10, 25, 50, 100, 200, 400]
    : [10, 100, 1000, 10000];

  for (const pc of steps) {
    const radius = toScene(pc);
    if (!Number.isFinite(radius) || radius < 2) continue;

    const points: THREE.Vector3[] = [];
    const segments = 220;
    for (let i = 0; i <= segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x38bdf8, transparent: true, opacity: 0.11, depthWrite: false,
    });
    const ring = new THREE.Line(geometry, material);
    ring.name = `ring-${pc}pc`;
    group.add(ring);

    // Two label anchors per ring, on opposite sides.
    for (const angle of [0.5, Math.PI + 0.5]) {
      const label = makeLabelSprite(pc >= 1000 ? `${pc / 1000} kpc` : `${pc} pc`);
      label.position.set(Math.cos(angle) * radius, 0.7, Math.sin(angle) * radius);
      group.add(label);
    }
  }

  return group;
}

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(148,197,255,0.92)";
  ctx.font = "600 30px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false,
  }));
  sprite.scale.set(7.2, 1.8, 1);
  return sprite;
}

function radialTexture(inner: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, "rgba(255,214,150,0.35)");
  gradient.addColorStop(1, "rgba(255,180,90,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Where the galactic centre lands on the compressed scale, in scene units. */
export function galacticCentreScene(): { x: number; z: number } {
  return { x: distanceToScene(SUN_GALACTOCENTRIC_PC), z: 0 };
}
