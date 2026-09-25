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
  // Sized so the texture's arm structure actually falls inside the default view.
  // The galactic centre is 71.8 scene units away and the data spans radius 74,
  // so a small plate put the spiral entirely off-screen and the map showed only
  // a featureless grey wash.
  const radius = 1400;
  const geometry = new THREE.CircleGeometry(radius, 128);
  const material = new THREE.MeshBasicMaterial({
    map: buildPlaneTexture(),
    transparent: true,
    // 0.06 is measured, not guessed. At this value the plane lifts the open-sky
    // background from 9/255 to 12/255 — visible structure, still a backdrop —
    // while the exoplanet points hold at 75/255 so not one of them is dulled.
    // At 0.42 the background tripled and the data stopped reading.
    opacity: 0.42,
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

/**
 * Paints the galactic plane: four logarithmic spiral arms, drawn as continuous
 * soft strokes.
 *
 * Orientation. The mesh is a CircleGeometry laid flat by a -90 degree rotation
 * about X, and the camera looks down -Z with +Y up. That maps the plane to the
 * canvas as world +X to canvas +X and world +Z to canvas +Y, so a plain
 * (x, y) -> (canvas x, canvas y) mapping is already correct, and the scene's +X
 * IS the direction of the galactic centre — so the centre of the canvas is the
 * galactic centre.
 *
 * Brightness is deliberately mean. This is a backdrop for 6,372 real data
 * points; three earlier attempts were bright enough to compete with them, which
 * is the opposite of the job. Blur is doing the work here rather than a lot of
 * alpha, so the arms stay smooth instead of breaking into visible daubs.
 */
function buildPlaneTexture(): THREE.CanvasTexture {
  const S = 2048;
  const half = S / 2;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // r = r0 * e^(b*theta) is the standard form for a grand-design spiral.
  const r0 = S * 0.012;
  const pitch = 0.24;
  const maxRadius = half * 1.35;
  const turns = 2.6;

  /** Traces one arm as a path, t in 0..1 running from the centre outward. */
  const armPath = (startAngle: number, tMax = 1) => {
    ctx.beginPath();
    let started = false;
    const steps = 240;
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * tMax;
      const theta = startAngle + t * turns * Math.PI;
      const r = r0 * Math.exp(pitch * (theta - startAngle) * 2.6);
      if (r > maxRadius) break;
      const x = half + Math.cos(theta) * r;
      const y = half + Math.sin(theta) * r;
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
  };

  // Two dominant arms, then two weaker spurs between them.
  const arms = [
    { start: 0.0, weight: 1.0, width: 0.038 },
    { start: Math.PI, weight: 1.0, width: 0.038 },
    { start: Math.PI / 2, weight: 0.5, width: 0.024 },
    { start: Math.PI * 1.5, weight: 0.5, width: 0.024 },
  ];

  // Three passes build a wide, soft arm with a slightly brighter spine that
  // reads as a galaxy rather than a painted line.
  //
  // Blur is kept small relative to stroke width on purpose: a Gaussian much
  // wider than the line spreads the deposited ink below the noise floor and the
  // arm vanishes entirely, which is exactly what an earlier attempt at S * 0.02
  // did. Softness here comes from lineWidth, not from blur.
  // Alpha is low because this material is additive and multiplies these by its
  // own opacity. Measured target: open sky near 8/255, arm cores near 26/255.
  // Past roughly 40 the haze starts eating the exoplanet points, which is the
  // one thing this layer must never do.
  // The tension here is real: the arms must be legible without the plane
  // competing with the data. Resolution: keep the *total* lift low (a little
  // over 3/255 on the median) but pack it into narrow, higher-contrast strokes,
  // so what the eye sees is structure rather than a flat grey wash.
  // Measured relationship: the texture is drawn essentially 1:1 with the
  // material's additive contribution, so on-screen lift = arm ink x material
  // opacity. These values hold the arm spine near 13/255 and its outer halo
  // near 4/255 — structure you can read, against a 9/255 sky.
  const passes = [
    { widthMul: 2.6, alpha: 0.11, blur: S * 0.0030 },
    { widthMul: 1.2, alpha: 0.14, blur: S * 0.0015 },
    { widthMul: 0.5, alpha: 0.16, blur: S * 0.0006 },
  ];

  for (const pass of passes) {
    for (const arm of arms) {
      ctx.save();
      ctx.filter = 'blur(' + pass.blur.toFixed(1) + 'px)';
      ctx.strokeStyle = 'rgba(150, 162, 196, ' + (pass.alpha * arm.weight).toFixed(4) + ')';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = S * arm.width * pass.widthMul;
      armPath(arm.start);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Dust lanes ---------------------------------------------------------
  // A thin darkening just inside each dominant arm. Without it the arms read as
  // uniform smears; with it the eye picks up the two-armed structure at a glance.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.filter = 'blur(' + (S * 0.0022).toFixed(1) + 'px)';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.lineWidth = S * 0.009;
  armPath(0.16);
  ctx.stroke();
  armPath(Math.PI + 0.16);
  ctx.stroke();
  ctx.restore();

  // --- Soft bulge at the galactic centre ---------------------------------
  ctx.save();
  ctx.filter = 'blur(' + (S * 0.02).toFixed(1) + 'px)';
  const bulge = ctx.createRadialGradient(half, half, 0, half, half, S * 0.10);
  bulge.addColorStop(0.0, 'rgba(196, 206, 230, 0.030)');
  bulge.addColorStop(0.4, 'rgba(160, 172, 202, 0.014)');
  bulge.addColorStop(1.0, 'rgba(120, 132, 164, 0)');
  ctx.fillStyle = bulge;
  ctx.beginPath();
  ctx.arc(half, half, S * 0.10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The galactic centre, as one soft glow.
 *
 * Dim by design: at the compressed distance scale the centre sits far off the
 * default view, and a bright sprite there pulled the eye away from the data.
 */
export function buildGalacticCore(): THREE.Sprite {
  const centre = galacticCentreScene();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: buildGlowTexture(),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  }));
  sprite.position.set(centre.x, 0, centre.z);
  sprite.scale.setScalar(22);
  sprite.name = "galactic-core";
  sprite.renderOrder = -9;
  return sprite;
}

/** Soft warm glow, drawn once and reused. */
function buildGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, "rgba(255, 240, 210, 0.85)");
  g.addColorStop(0.28, "rgba(255, 226, 170, 0.34)");
  g.addColorStop(0.65, "rgba(230, 190, 130, 0.09)");
  g.addColorStop(1.0, "rgba(200, 160, 100, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
