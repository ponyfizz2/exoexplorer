/**
 * SYSTEM VIEW — one planetary system, rendered to scale.
 *
 * Everything here is physically derived, not decorative:
 *   - the star is rendered at its real radius (log-compressed, or a red dwarf
 *     would vanish and a supergiant would swallow the frame);
 *   - orbital radii, eccentricity and period all come from the archive;
 *   - the green annulus is the actual Kopparapu habitable zone for that star's
 *     temperature and luminosity, so "is this world in the zone?" is answered by
 *     geometry rather than by a caption;
 *   - sibling planets in the same system are drawn so you can see the
 *     architecture of, say, TRAPPIST-1 at a glance.
 */

import * as THREE from "three";
import type { DerivedPlanet } from "../lib/types";
import { buildSurface, starColorFor } from "./planetTextures";
import { createComposer, shouldUseBloom, type ComposerHandle } from "./composer";
import { clamp } from "../lib/utils";

/** Scene units per AU at the 1 AU reference point. */
const AU_UNIT = 180;

/**
 * Compressed but strictly monotonic mapping from AU to scene units, so that a
 * 0.004 AU ultra-short-period planet and a 1,000 AU imaging target can share a
 * frame without either disappearing.
 */
export function auToScene(au: number): number {
  const a = Math.max(au, 1e-4);
  return AU_UNIT * (1 + Math.log10(a * 1000) * 0.42);
}

/** Star radius in scene units: sqrt-compressed so small stars stay visible. */
export function starRadiusToScene(solarRadii: number): number {
  return 6 + Math.sqrt(Math.max(solarRadii, 0.02)) * 12;
}

interface OrbitEntry {
  derived: DerivedPlanet;
  mesh: THREE.Object3D;
  pivot: THREE.Object3D;
  radiusScene: number;
  eccentricity: number;
  inclinationRad: number;
  phase: number;
  angularSpeed: number;
}

export class SystemView {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls?: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  private post: ComposerHandle | null = null;
  private raf = 0;
  private disposed = false;
  private paused = false;
  private resizeObserver: ResizeObserver;
  private root = new THREE.Group();
  private orbits: OrbitEntry[] = [];
  private rotateDisposables: { geometry: THREE.BufferGeometry; material: THREE.Material; texture?: THREE.Texture }[] = [];

  private timeScale = 1;
  private elapsedDays = 0;
  private lastFrameTime = 0;
  private reduced: boolean;

  constructor(container: HTMLElement) {
    this.container = container;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    // No tone mapping: the ACES curve swallows the dim rims and rings.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.add(this.root);

    this.camera = new THREE.PerspectiveCamera(50, (container.clientWidth || 1) / (container.clientHeight || 1), 0.1, 200000);
    this.camera.position.set(0, 160, 420);

    void import("three/examples/jsm/controls/OrbitControls.js").then(({ OrbitControls }) => {
      if (this.disposed) return;
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.minDistance = 8;
      this.controls.maxDistance = 60000;
      this.controls.autoRotate = !this.reduced;
      this.controls.autoRotateSpeed = 0.28;
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    window.addEventListener("resize", this.handleResize);

    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }

  /** Read-only introspection hook, used by the browser test suite. */
  debugState(): unknown {
    return {
      camera: this.camera.position.toArray(),
      near: this.camera.near,
      far: this.camera.far,
      fov: this.camera.fov,
      orbitCount: this.orbits.length,
      orbits: this.orbits.map((o) => ({
        id: o.derived.id,
        radiusScene: Math.round(o.radiusScene),
        pos: o.mesh.position.toArray().map((v) => Math.round(v)),
        visible: o.mesh.visible,
        childCount: o.mesh.children.length,
      })),
      rootChildren: this.root.children.map((c) => c.name || c.type),
    };
  }

  /** Renders `focus` as the centrepiece; `siblings` are the other planets of the same host. */
  setSystem(focus: DerivedPlanet, siblings: DerivedPlanet[] = []): void {
    this.clearScene();

    const star = focus.star;
    const starRadii = focus.planet.st_rad && focus.planet.st_rad > 0 ? focus.planet.st_rad : 1;
    const starRadius = starRadiusToScene(starRadii);
    const starColorHex = starColorFor(focus.planet.st_teff);

    // --- Star ---------------------------------------------------------------
    const starGroup = new THREE.Group();
    starGroup.name = "star";
    const starTexture = this.buildStarTexture(starColorHex);
    const starMat = new THREE.MeshBasicMaterial({ map: starTexture, color: 0xffffff });
    const starMesh = new THREE.Mesh(new THREE.SphereGeometry(starRadius, 64, 64), starMat);
    starGroup.add(starMesh);

    // Additive corona shells give the star real presence without a post pass.
    // Tight, additive shells: a wide first shell reads as a hard opaque rim.
    for (const [scale, opacity] of [[1.035, 0.34], [1.12, 0.14], [1.45, 0.05]] as const) {
      const shellMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(starColorHex), transparent: true, opacity,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      });
      const shell = new THREE.Mesh(new THREE.SphereGeometry(starRadius * scale, 48, 48), shellMat);
      starGroup.add(shell);
      this.rotateDisposables.push({ geometry: shell.geometry, material: shellMat });
    }
    this.root.add(starGroup);

    // The star is the key light. Inverse-square decay (the physical default) is
    // useless here: scene orbits span hundreds of units, so 1/d² leaves every
    // planet black. A gentler decay keeps the near/far falloff readable while
    // still letting the day/night terminator land correctly.
    const starLight = new THREE.PointLight(new THREE.Color(starColorHex), 320000, 0, 1.55);
    starLight.position.set(0, 0, 0);
    starLight.castShadow = true;
    starLight.shadow.mapSize.set(1024, 1024);
    this.root.add(starLight);

    // A weak fill so the night side is legible rather than pure black.
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.16);
    fill.position.set(-1, 0.6, -0.8);
    this.root.add(fill);
    this.root.add(new THREE.AmbientLight(0x223050, 0.7));

    // --- Habitable zone -----------------------------------------------------
    if (star.hzInner !== null && star.hzOuter !== null) {
      const inner = auToScene(star.hzInner);
      const outer = auToScene(star.hzOuter);
      const hzGeo = new THREE.RingGeometry(inner, outer, 160, 1);
      const hzMat = new THREE.MeshBasicMaterial({
        color: 0x22c55e, transparent: true, opacity: 0.1,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const hz = new THREE.Mesh(hzGeo, hzMat);
      hz.rotation.x = -Math.PI / 2;
      hz.name = "habitable-zone";
      this.root.add(hz);
      this.rotateDisposables.push({ geometry: hzGeo, material: hzMat });

      if (star.hzInnerOptimistic !== null && star.hzOuterOptimistic !== null) {
        const optGeo = new THREE.RingGeometry(auToScene(star.hzInnerOptimistic), auToScene(star.hzOuterOptimistic), 160, 1);
        const optMat = new THREE.MeshBasicMaterial({
          color: 0x86efac, transparent: true, opacity: 0.045,
          side: THREE.DoubleSide, depthWrite: false,
        });
        const opt = new THREE.Mesh(optGeo, optMat);
        opt.rotation.x = -Math.PI / 2;
        this.root.add(opt);
        this.rotateDisposables.push({ geometry: optGeo, material: optMat });
      }
    }

    // --- Planets ------------------------------------------------------------
    const roster = [focus, ...siblings.filter((s) => s.id !== focus.id)];
    const periods = roster.map((r) => r.planet.pl_orbper ?? 365).filter((p) => Number.isFinite(p) && p > 0);
    const fastest = periods.length ? Math.min(...periods) : 365;
    // Never let the innermost world complete an orbit faster than ~1.5 s on screen.
    const baseSpeed = 0.06;

    for (const entry of roster) {
      const axisAu = entry.semiMajorAxis ?? 1;
      const radiusScene = auToScene(axisAu);
      const eccentricity = Math.min(entry.planet.pl_orbeccen ?? 0, 0.85);
      const inclination = THREE.MathUtils.degToRad(entry.planet.pl_orbincl ?? 0);

      const pivot = new THREE.Group();
      pivot.rotation.x = inclination;

      // Orbit path.
      const curve = new THREE.EllipseCurve(0, 0, radiusScene, radiusScene * (1 - eccentricity), 0, Math.PI * 2);
      const points = curve.getPoints(220).map((p) => new THREE.Vector3(p.x, 0, p.y));
      const orbitGeo = new THREE.BufferGeometry().setFromPoints(points);
      const isFocus = entry.id === focus.id;
      const orbitMat = new THREE.LineBasicMaterial({
        color: isFocus ? 0x00f3ff : 0x3b4a63,
        transparent: true,
        opacity: isFocus ? 0.75 : 0.4,
      });
      const orbitLine = new THREE.Line(orbitGeo, orbitMat);
      pivot.add(orbitLine);
      this.rotateDisposables.push({ geometry: orbitGeo, material: orbitMat });

      // Planet body.
      const body = this.buildPlanetBody(entry);
      pivot.add(body);
      this.root.add(pivot);

      const period = entry.planet.pl_orbper && entry.planet.pl_orbper > 0 ? entry.planet.pl_orbper : 365;
      const angularSpeed = (Math.PI * 2 * baseSpeed) / Math.max(period / fastest, 0.05);

      this.orbits.push({
        derived: entry,
        mesh: body,
        pivot,
        radiusScene,
        eccentricity,
        inclinationRad: inclination,
        phase: Math.random() * Math.PI * 2,
        angularSpeed: isFocus ? angularSpeed : angularSpeed,
      });
    }

    // --- Camera -------------------------------------------------------------
    // --- Camera ------------------------------------------------------------
    // Fit the orbit to the *viewport*, not to a guess. The panel is often taller
    // than it is wide, so the horizontal field of view is usually the binding
    // constraint — fitting to the vertical one pushes the planet off screen.
    const focusEntry = this.orbits.find((o) => o.derived.id === focus.id) ?? this.orbits[0];
    const focusRadius = focusEntry?.radiusScene ?? auToScene(1);
    const aspect = (this.container.clientWidth || 1) / (this.container.clientHeight || 1);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const limiting = Math.min(vFov, hFov);
    // Distance at which a disc of this radius just fits, plus 12% breathing room.
    const framing = clamp((focusRadius * 1.12) / Math.tan(limiting / 2), 40, 90000);

    // Look from above and to the side, so the orbit reads as an ellipse with
    // depth rather than as a flat line, and the day/night terminator is visible.
    const direction = new THREE.Vector3(Math.sin(0.55), 0.42, Math.cos(0.55)).normalize();
    this.camera.near = Math.max(0.2, framing / 2000);
    this.camera.far = framing * 12;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(direction.multiplyScalar(framing));
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  private buildPlanetBody(entry: DerivedPlanet): THREE.Group {
    const group = new THREE.Group();
    const maps = buildSurface(entry.id, entry.cls, entry.equilibriumTemp, entry.radiusEarth);

    const earthRadii = entry.radiusEarth ?? 1;
    // Physical size is square-root compressed (Jupiter is only 11× Earth, while
    // the compressed orbit scale is ~400× the planet scale) and floored so even a
    // Mercury-sized world reads as a disc rather than a speck.
    const radius = Math.max(6, 13 * Math.sqrt(Math.max(earthRadii, 0.05)));

    const surfaceTex = new THREE.CanvasTexture(maps.surface);
    surfaceTex.colorSpace = THREE.SRGBColorSpace;
    surfaceTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const material = new THREE.MeshStandardMaterial({
      map: surfaceTex,
      roughness: 0.88,
      metalness: 0.02,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: surfaceTex,
      emissiveIntensity: 0.16,
    });

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 64), material);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    group.add(sphere);
    this.rotateDisposables.push({ geometry: sphere.geometry, material, texture: surfaceTex });

    // Independently rotating cloud deck.
    if (maps.clouds) {
      const cloudTex = new THREE.CanvasTexture(maps.clouds);
      cloudTex.colorSpace = THREE.SRGBColorSpace;
      const cloudMat = new THREE.MeshStandardMaterial({
        map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, roughness: 1,
      });
      const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.015, 48, 48), cloudMat);
      cloudMesh.name = "clouds";
      group.add(cloudMesh);
      this.rotateDisposables.push({ geometry: cloudMesh.geometry, material: cloudMat, texture: cloudTex });
    }

    // Night-side emission (lava or city lights).
    if (maps.emissive) {
      const emissiveTex = new THREE.CanvasTexture(maps.emissive);
      emissiveTex.colorSpace = THREE.SRGBColorSpace;
      const eMat = new THREE.MeshBasicMaterial({
        map: emissiveTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
      });
      const eMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.002, 48, 48), eMat);
      group.add(eMesh);
      this.rotateDisposables.push({ geometry: eMesh.geometry, material: eMat, texture: emissiveTex });
    }

    // Atmosphere rim: a slightly larger back-side sphere gives a convincing limb.
    const atmoMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(maps.palette.atmosphere.replace(/rgba?\(([^)]+)\)/, (_, inner: string) => {
        const [r, g, b] = inner.split(",").map((s: string) => parseFloat(s.trim()));
        return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      })),
      transparent: true,
      opacity: 0.22,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.12, 48, 48), atmoMat);
    group.add(atmo);
    this.rotateDisposables.push({ geometry: atmo.geometry, material: atmoMat });

    // Rings for giants — and for anything large enough that a ring is plausible.
    if (earthRadii > 6 && (entry.cls === "Jovian" || entry.cls === "Sub-Jovian")) {
      const ringGeo = new THREE.RingGeometry(radius * 1.5, radius * 2.4, 96);
      const ringCanvas = this.buildRingTexture();
      const ringTex = new THREE.CanvasTexture(ringCanvas);
      ringTex.colorSpace = THREE.SRGBColorSpace;
      const ringMat = new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, side: THREE.DoubleSide, opacity: 0.72, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2 - 0.32;
      group.add(ring);
      this.rotateDisposables.push({ geometry: ringGeo, material: ringMat, texture: ringTex });
    }

    // Tidal lock hint: ultra-short-period worlds rotate once per orbit.
    group.userData.spin = entry.planet.pl_orbper && entry.planet.pl_orbper < 3 ? 0.004 : 0.02 + Math.random() * 0.03;
    return group;
  }

  private buildStarTexture(colorHex: string): THREE.Texture {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size / 2;
    const ctx = canvas.getContext("2d")!;
    const base = new THREE.Color(colorHex);
    ctx.fillStyle = `rgb(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)})`;
    ctx.fillRect(0, 0, size, size / 2);

    // Granulation: a coarse noise wash plus brighter flare patches.
    const image = ctx.getImageData(0, 0, size, size / 2);
    const rand = (() => { let s = 1337; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const grid = new Float32Array(64 * 32);
    for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
    const sample = (x: number, y: number) => grid[(y & 31) * 64 + (x & 63)];
    for (let y = 0; y < size / 2; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const gx = x / 8; const gy = y / 8;
        const n = sample(Math.floor(gx), Math.floor(gy));
        const n2 = sample(Math.floor(gx / 4), Math.floor(gy / 4));
        const v = (n * 0.6 + n2 * 0.4 - 0.5) * 0.34;
        const idx = (y * size + x) * 4;
        image.data[idx] = Math.max(0, Math.min(255, image.data[idx] * (1 + v)));
        image.data[idx + 1] = Math.max(0, Math.min(255, image.data[idx + 1] * (1 + v)));
        image.data[idx + 2] = Math.max(0, Math.min(255, image.data[idx + 2] * (1 + v)));
      }
    }
    ctx.putImageData(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  private buildRingTexture(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 8;
    const ctx = canvas.getContext("2d")!;
    for (let x = 0; x < canvas.width; x += 1) {
      const t = x / canvas.width;
      const band = 0.35 + 0.65 * Math.abs(Math.sin(t * 42) * Math.sin(t * 7 + 1.2));
      const gap = t > 0.61 && t < 0.66 ? 0.06 : 1; // Cassini-division style gap
      const alpha = band * gap;
      ctx.fillStyle = `rgba(226, 214, 190, ${alpha.toFixed(3)})`;
      ctx.fillRect(x, 0, 1, canvas.height);
    }
    return canvas;
  }

  private clearScene(): void {
    for (const entry of this.rotateDisposables) {
      entry.geometry.dispose();
      entry.material.dispose();
      entry.texture?.dispose();
    }
    this.rotateDisposables = [];
    this.orbits = [];
    while (this.root.children.length) {
      const child = this.root.children.pop()!;
      this.root.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
        }
      });
    }
  }

  setPaused(paused: boolean): void { this.paused = paused; }
  setTimeScale(scale: number): void { this.timeScale = scale; }

  private handleResize = (): void => {
    if (this.disposed || !this.container.clientWidth || !this.container.clientHeight) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
  };

  private animate(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);

    const dt = this.lastFrameTime ? Math.min(now - this.lastFrameTime, 80) : 16;
    this.lastFrameTime = now;

    if (!this.paused) {
      this.elapsedDays += (dt / 1000) * this.timeScale * 6;
      for (const orbit of this.orbits) {
        const angle = orbit.phase + this.elapsedDays * orbit.angularSpeed * 0.02;
        const x = Math.cos(angle) * orbit.radiusScene;
        const z = Math.sin(angle) * orbit.radiusScene * (1 - orbit.eccentricity);
        orbit.mesh.position.set(x, 0, z);
        const spin = orbit.mesh.userData.spin ?? 0.02;
        orbit.mesh.rotation.y += spin * (dt / 1000) * 60;
        const clouds = orbit.mesh.getObjectByName("clouds");
        if (clouds) clouds.rotation.y += spin * 0.35 * (dt / 1000) * 60;
      }
    }

    this.controls?.update();
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.handleResize);
    this.clearScene();
    this.controls?.dispose();
    this.post?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
