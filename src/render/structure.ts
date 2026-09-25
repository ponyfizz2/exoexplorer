/**
 * Everything on the map that is NOT data.
 *
 * The design rule: non-data is a surface or a line — never a dot. Individual
 * dots are reserved for the 6,366 confirmed planets, because that is what the
 * viewer is here to look at, and a field of decorative star sprites competes
 * with them directly.
 *
 * So the Milky Way is drawn as a smooth shaded band on a sky dome, the galactic
 * centre as one soft glow, and distance as faint rings. None of it is measured
 * data and none of it is dot-shaped.
 */

import * as THREE from "three";
import { makeLabel, radialTexture } from "./stars";

const SUN_GALACTOCENTRIC_PC = 8150;

/** Must match SCENE_EXTENT in galaxy.ts. */
const SCENE_EXTENT = 74;

/** Heliocentric galactic distance (parsecs) -> the compressed scene radius. */
function distanceToScene(pc: number): number {
  const d = Math.min(Math.max(pc, 1.3), 12000);
  return 0.9 + (Math.log10(d / 1.3) / Math.log10(12000 / 1.3)) * SCENE_EXTENT;
}

/**
 * The Milky Way band, as a single inside-out sphere with a procedural shader.
 *
 * The dome is rendered at a fixed radius and is completely unaffected by the
 * map's compressed distance scale — it is scenery, not measurement. Brightness
 * falls off as a Gaussian in galactic latitude, so the band is a broad haze
 * rather than a hard stripe, and an inner glow marks the galactic centre.
 *
 * Deliberate consequence: the band sits on the true galactic equator, so the
 * viewer can see for themselves which worlds lie in the disk and which do not.
 */
/**
 * The galactic plane, as a flat translucent disc.
 *
 * This is the "Milky Way" on the map: a soft grey haze lying exactly on the
 * galactic equator (scene y = 0), brightest toward the galactic centre and
 * fading to nothing at the rim. Seen from the default camera, tilted 42 degrees
 * off the plane, it reads as the band you would see in a dark-sky photograph.
 *
 * A flat disc rather than a sky dome deliberately: the dome needed a spherical
 * UV mapping and a shader, both of which proved fragile across GPUs. A plane on
 * y = 0 is the same geometry as the distance rings, is trivially correct, and
 * places the haze at the physically meaningful location rather than on a
 * backdrop. Additive blending keeps it behind the data and never occludes a
 * single exoplanet.
 */
export function buildGalacticPlane(): THREE.Mesh {
  const radius = 1600;
  const geometry = new THREE.CircleGeometry(radius, 128);
  const material = new THREE.MeshBasicMaterial({
    map: buildPlaneTexture(),
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // CircleGeometry is built in the XY plane; lay it flat on the galactic plane.
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'galactic-plane';
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
  return mesh;
}

/** Radial grey haze: bright at the galactic centre, fading out at the rim. */
function buildPlaneTexture(): THREE.CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // Neutral grey throughout — this is a surface, not a data channel.
  g.addColorStop(0.00, 'rgba(190, 199, 222, 1.00)');
  g.addColorStop(0.05, 'rgba(170, 179, 205, 0.82)');
  g.addColorStop(0.16, 'rgba(140, 150, 180, 0.52)');
  g.addColorStop(0.38, 'rgba(106, 116, 146, 0.30)');
  g.addColorStop(0.68, 'rgba(78, 88, 114, 0.13)');
  g.addColorStop(1.00, 'rgba(44, 52, 74, 0.0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

export function buildGalacticCore(): THREE.Sprite {
  const centre = galacticCentreScene();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture("rgba(255,238,205,0.9)"),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  sprite.position.set(centre.x, 0, centre.z);
  sprite.scale.setScalar(26);
  sprite.name = "galactic-core";
  sprite.renderOrder = -9;
  return sprite;
}

/** Faint concentric rings marking distance, with labels on two sides. */
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
      color: 0x7c8ba1, transparent: true, opacity: 0.13, depthWrite: false,
    });
    const ring = new THREE.Line(geometry, material);
    ring.name = `ring-${pc}pc`;
    group.add(ring);

    for (const angle of [0.45, Math.PI + 0.45]) {
      const label = makeLabel(pc >= 1000 ? `${pc / 1000} kpc` : `${pc} pc`);
      label.position.set(Math.cos(angle) * radius, 0.5, Math.sin(angle) * radius);
      group.add(label);
    }
  }

  return group;
}

/** Where the galactic centre lands on the compressed scale, in scene units. */
export function galacticCentreScene(): { x: number; z: number } {
  return { x: distanceToScene(SUN_GALACTOCENTRIC_PC), z: 0 };
}
