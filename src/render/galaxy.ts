/**
 * THE GALACTIC MAP — every confirmed exoplanet, positioned in real 3D space.
 *
 * The archive gives galactic longitude/latitude plus a distance in parsecs, so
 * each world is placed with the standard spherical->Cartesian transform rather
 * than an invented layout. 6,366 points are drawn as a single additive point
 * cloud with per-point colour and size, which keeps the whole thing at one draw
 * call and comfortably interactive.
 *
 * Colour and size can both be re-mapped live (class, temperature, method, year,
 * habitability / radius, mass, distance) without touching the geometry.
 */

import * as THREE from "three";
import type { DerivedPlanet, PlanetClass } from "../lib/types";
import { CLASS_COLORS } from "../lib/astronomy";
import { clamp, temperatureColor } from "../lib/utils";
import { buildGalacticBackdrop, NEARBY_STARS } from "./stars";
import { buildGalacticStructure, buildDistanceRings } from "./structure";
import { starColorFor } from "./planetTextures";
import { createComposer, shouldUseBloom, type ComposerHandle } from "./composer";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ColorMode = "class" | "temperature" | "method" | "year" | "habitability";
export type SizeMode = "radius" | "mass" | "year" | "distance" | "uniform";

export interface GalaxyOptions {
  reducedMotion: boolean;
}

interface Pickable { index: number; position: THREE.Vector3 }

const METHOD_COLORS: Record<string, string> = {
  Transit: "#22d3ee",
  "Radial Velocity": "#f472b6",
  Microlensing: "#a78bfa",
  Imaging: "#facc15",
  "Transit Timing Variations": "#fb923c",
  "Eclipse Timing Variations": "#f87171",
  "Orbital Brightness Modulation": "#4ade80",
  "Pulsar Timing": "#34d399",
  Astrometry: "#60a5fa",
  "Pulsation Timing Variations": "#f0abfc",
  "Disk Kinematics": "#94a3b8",
};

export function methodColor(method: string): string {
  return METHOD_COLORS[method] ?? "#94a3b8";
}

export const DISCOVERY_METHODS = Object.keys(METHOD_COLORS);

/**
 * Galactocentric Cartesian coordinates from galactic longitude l, latitude b and
 * distance d (parsecs). The Sun sits at (-8.15, 0, 0) kpc relative to the
 * galactic centre; for a map on this scale we keep the Sun at the origin and
 * plot everything relative to it, which is what makes the local bubble legible.
 */
export function galacticToCartesian(lDeg: number, bDeg: number, distancePc: number, sunOffsetPc = 8150): THREE.Vector3 {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  // Heliocentric frame: +x toward the galactic centre, +z out of the plane.
  const x = distancePc * Math.cos(b) * Math.cos(l);
  const y = distancePc * Math.cos(b) * Math.sin(l);
  const z = distancePc * Math.sin(b);
  // Re-centre on the galactic centre so the spiral make sense at wide zoom.
  return new THREE.Vector3(x + sunOffsetPc, y, z);
}

/** Heliocentric variant used for the default (Sun-centred) view. */
export function heliocentric(lDeg: number, bDeg: number, distancePc: number): THREE.Vector3 {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  return new THREE.Vector3(
    distancePc * Math.cos(b) * Math.cos(l),
    distancePc * Math.sin(b),
    -distancePc * Math.cos(b) * Math.sin(l),
  );
}

/**
 * Two ways to project distance into scene units.
 *
 *  - "galactic": logarithmic, so 1.3 pc and 12 kpc can share a frame. The cost is
 *    that the ~3,000 systems within 300 pc collapse into a single bright core.
 *  - "local": linear, so structure inside the Sun's neighbourhood is actually
 *    visible. Everything beyond the horizon is clamped to the rim rather than
 *    deleted, which is why the far field reads as a shell.
 */
export type Portal = "galactic" | "local";

export const LOCAL_HORIZON_PC = 400;

/** Total radius of the mapped volume, in scene units. */
export const SCENE_EXTENT = 74;

export function distanceToScene(distancePc: number, portal: Portal): number {
  if (portal === "local") {
    return 1 + (clamp(distancePc, 0, LOCAL_HORIZON_PC) / LOCAL_HORIZON_PC) * SCENE_EXTENT;
  }
  const d = clamp(distancePc, 1.3, 12000);
  const t = Math.log10(d / 1.3) / Math.log10(12000 / 1.3);
  return 0.9 + t * SCENE_EXTENT;
}

export class GalaxyView {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  /** Attached asynchronously so the OrbitControls chunk is not on the critical path. */
  private controls?: OrbitControls;
  private post: ComposerHandle | null = null;
  private raf = 0;
  private disposed = false;
  private reduced: boolean;
  private resizeObserver: ResizeObserver;

  private points!: THREE.Points;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private planets: DerivedPlanet[] = [];
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private sizes = new Float32Array(0);
  private baseSizes = new Float32Array(0);
  private visibility = new Float32Array(0);
  private targetVisibility = new Float32Array(0);
  private pickables: Pickable[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);

  private sun!: THREE.Group;
  private highlight!: THREE.Mesh;
  private selectionRing!: THREE.Line;
  private structure: THREE.Group | null = null;
  private rings: THREE.Group | null = null;

  private colorMode: ColorMode = "class";
  private sizeMode: SizeMode = "radius";
  private portal: Portal = "local";
  private yearFilter = 2026;
  private selectedIndex = -1;
  private hoveredIndex = -1;
  private frameTimes: number[] = [];
  private bloomEnabled: boolean;
  private onHover: ((p: DerivedPlanet | null, event: PointerEvent) => void) | null = null;
  private onSelect: ((p: DerivedPlanet) => void) | null = null;

  constructor(container: HTMLElement, _options: GalaxyOptions) {
    this.container = container;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.bloomEnabled = shouldUseBloom();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.85));
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    // No tone mapping here: ACES crushes the dim additive points into black.
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    // A 55 degree field of view framing the whole local bubble puts thousands of
    // real worlds on screen at once, which is the point of the view.
    this.camera = new THREE.PerspectiveCamera(55, (container.clientWidth || 1) / (container.clientHeight || 1), 0.05, 3000);
    this.camera.position.set(0, 88, 26);
    this.controlsTargetHint = new THREE.Vector3(0, 0, 0);

    this.scene.add(buildGalacticBackdrop());
    this.buildStructure();
    this.buildSun();
    this.buildHighlight();

    void import("three/examples/jsm/controls/OrbitControls.js").then(({ OrbitControls }) => {
      if (this.disposed) return;
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.06;
      this.controls.rotateSpeed = 0.42;
      this.controls.zoomSpeed = 0.85;
      this.controls.minDistance = 0.6;
      this.controls.maxDistance = 420;
      this.controls.autoRotate = false;
      this.controls.enablePan = true;
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    // Containers that start hidden report 0x0; re-measure as soon as they don't.
    if (!container.clientWidth || !container.clientHeight) {
      const settle = new ResizeObserver(() => {
        if (container.clientWidth && container.clientHeight) {
          this.handleResize();
          settle.disconnect();
        }
      });
      settle.observe(container);
    }

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.domElement.addEventListener("click", this.handleClick);
    window.addEventListener("resize", this.handleResize);

    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }

  // --- Scene construction ---------------------------------------------------

  /** Schematic galaxy plus distance rings — context, never presented as data. */
  private buildStructure(): void {
    this.structure = buildGalacticStructure();
    this.scene.add(this.structure);
    this.rebuildRings();
  }

  private rebuildRings(): void {
    if (this.rings) {
      this.scene.remove(this.rings);
      this.rings.traverse((object) => {
        if (object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry?.dispose();
          (object.material as THREE.Material | undefined)?.dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
    }
    this.rings = buildDistanceRings(this.portal, (pc) => distanceToScene(pc, this.portal));
    this.scene.add(this.rings);
  }

  private buildSun(): void {
    const group = new THREE.Group();
    group.name = "sun";

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff6d5 }),
    );
    group.add(core);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture("#ffe9a8"),
      color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(5.2);
    group.add(glow);

    // The 25 nearest real stars, so the local bubble is recognisable.
    group.add(this.buildNeighbourLabels());
    this.sun = group;
    this.scene.add(group);
  }

  private buildNeighbourLabels(): THREE.Group {
    const neighbours = new THREE.Group();
    neighbours.name = "neighbours";
    for (const star of NEARBY_STARS_CACHE) {
      const point = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(star.color) }),
      );
      point.position.copy(star.position);
      neighbours.add(point);
    }
    return neighbours;
  }

  private buildHighlight(): void {
    this.highlight = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.9 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    const ringGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      }),
    );
    this.selectionRing = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.85 }));
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
  }

  setPlanets(planets: DerivedPlanet[]): void {
    this.planets = planets;
    const n = planets.length;

    if (this.points) {
      this.scene.remove(this.points);
      this.geometry.dispose();
      this.material.dispose();
    }

    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.baseSizes = new Float32Array(n);
    this.visibility = new Float32Array(n);
    this.targetVisibility = new Float32Array(n);
    this.pickables = [];

    const radiusExtent = extent(planets.map((p) => p.radiusEarth));
    const massExtent = extent(planets.map((p) => p.massEarth));
    const distExtent = extent(planets.map((p) => p.planet.sy_dist ?? null));
    const yearExtent = extent(planets.map((p) => p.planet.disc_year));

    planets.forEach((p, i) => {
      const lon = p.planet.ra ?? 0;
      const lat = p.planet.dec ?? 0;
      const dist = p.planet.sy_dist ?? 100;
      const pos = heliocentric(lon, lat, distanceToScene(dist, this.portal));
      this.positions[i * 3] = pos.x;
      this.positions[i * 3 + 1] = pos.y;
      this.positions[i * 3 + 2] = pos.z;
      this.pickables.push({ index: i, position: pos });

      this.baseSizes[i] = this.sizeFor(p, { radiusExtent, massExtent, distExtent, yearExtent });

      const visible = p.planet.disc_year <= this.yearFilter ? 1 : 0;
      this.visibility[i] = visible;
      this.targetVisibility[i] = visible;
    });

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("visibility", new THREE.BufferAttribute(this.visibility, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // uScale converts world size to pixels, sized against SCENE_EXTENT so a
    // typical world lands at 5-15 px whether the map is zoomed in or out.
    uniforms: { uScale: { value: this.container.clientHeight * 0.2 }, uPixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: `
        attribute float size;
        attribute float visibility;
        varying vec3 vColor;
        varying float vVisibility;
        uniform float uScale;
        void main() {
          vColor = color;
          vVisibility = visibility;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (uScale / max(-mv.z, 0.001));
          gl_PointSize = clamp(gl_PointSize, 2.4, 90.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vVisibility;
        void main() {
          if (vVisibility < 0.02) discard;
          vec2 d = gl_PointCoord - vec2(0.5);
          float dist = length(d) * 2.0;
          if (dist > 1.0) discard;
          float core = pow(1.0 - dist, 2.4);
          float halo = pow(1.0 - dist, 1.0) * 0.55;
          // A brightness floor keeps every world readable instead of vanishing
          // into the background at low alpha.
          // Additive blending: keep the peak near 1.0 so saturated cores stay
          // white-hot without washing the whole map out.
          float energy = core + halo;
          gl_FragColor = vec4(mix(vColor, vColor * 1.7, core) * energy * 1.6,
                              clamp(energy * 1.15, 0.0, 1.0) * vVisibility);
        }
      `,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = "exoplanets";
    this.scene.add(this.points);

    this.applyColors();
    this.applySizes();
  }

  private sizeFor(p: DerivedPlanet, extents: Record<string, [number, number]>): number {
    const norm = (v: number | null, [lo, hi]: [number, number]) => {
      if (v === null || !Number.isFinite(v)) return 0.25;
      if (hi <= lo) return 0.5;
      return clamp((Math.log10(Math.max(v, 1e-4)) - Math.log10(Math.max(lo, 1e-4))) /
        (Math.log10(Math.max(hi, 1e-3)) - Math.log10(Math.max(lo, 1e-4))), 0, 1);
    };
    let t: number;
    switch (this.sizeMode) {
      case "radius": t = norm(p.radiusEarth, extents.radiusExtent); break;
      case "mass": t = norm(p.massEarth, extents.massExtent); break;
      case "distance": t = norm(p.planet.sy_dist ?? null, extents.distExtent); break;
      case "year":
        t = extents.yearExtent[1] > extents.yearExtent[0]
          ? clamp((p.planet.disc_year - extents.yearExtent[0]) / (extents.yearExtent[1] - extents.yearExtent[0]), 0, 1)
          : 0.5;
        break;
      default: t = 0.5;
    }
    return 0.16 + t * 0.62;
  }

  setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    this.applyColors();
  }

  /** Switches the distance projection and re-lays-out every point. */
  setPortal(portal: Portal): void {
    if (this.portal === portal) return;
    this.portal = portal;
    for (let i = 0; i < this.planets.length; i += 1) {
      const p = this.planets[i];
      const pos = heliocentric(p.planet.ra ?? 0, p.planet.dec ?? 0, distanceToScene(p.planet.sy_dist ?? 100, this.portal));
      this.positions[i * 3] = pos.x;
      this.positions[i * 3 + 1] = pos.y;
      this.positions[i * 3 + 2] = pos.z;
      this.pickables[i].position.copy(pos);
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    this.rebuildRings();
    this.clearFocus();
  }

  get portalValue(): Portal { return this.portal; }

  setSizeMode(mode: SizeMode): void {
    this.sizeMode = mode;
    const radiusExtent = extent(this.planets.map((p) => p.radiusEarth));
    const massExtent = extent(this.planets.map((p) => p.massEarth));
    const distExtent = extent(this.planets.map((p) => p.planet.sy_dist ?? null));
    const yearExtent = extent(this.planets.map((p) => p.planet.disc_year));
    const extents = { radiusExtent, massExtent, distExtent, yearExtent };
    for (let i = 0; i < this.planets.length; i += 1) {
      this.baseSizes[i] = this.sizeFor(this.planets[i], extents);
    }
    this.applySizes();
  }

  private colorFor(p: DerivedPlanet): THREE.Color {
    switch (this.colorMode) {
      case "temperature":
        return new THREE.Color(temperatureColor(p.equilibriumTemp));
      case "method":
        return new THREE.Color(methodColor(p.planet.discoverymethod));
      case "year": {
        const t = clamp((p.planet.disc_year - 1992) / 34, 0, 1);
        return new THREE.Color().setHSL(0.62 - t * 0.62, 0.85, 0.45 + t * 0.18);
      }
      case "habitability": {
        const t = clamp(p.habitability / 100, 0, 1);
        return t < 0.5
          ? new THREE.Color("#1e3a8a").lerp(new THREE.Color("#facc15"), t * 2)
          : new THREE.Color("#facc15").lerp(new THREE.Color("#22c55e"), (t - 0.5) * 2);
      }
      default:
        return new THREE.Color(CLASS_COLORS[p.cls as PlanetClass] ?? "#64748b");
    }
  }

  private applyColors(): void {
    if (!this.geometry) return;
    const attr = this.geometry.getAttribute("color") as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < this.planets.length; i += 1) {
      c.copy(this.colorFor(this.planets[i]));
      // Habitability is worth seeing in every mode: nudge the worthy ones brighter.
      const boost = 1 + clamp(this.planets[i].habitability / 100, 0, 1) * 0.5;
      this.colors[i * 3] = clamp(c.r * boost, 0, 1);
      this.colors[i * 3 + 1] = clamp(c.g * boost, 0, 1);
      this.colors[i * 3 + 2] = clamp(c.b * boost, 0, 1);
    }
    attr.needsUpdate = true;
  }

  private applySizes(): void {
    if (!this.geometry) return;
    const attr = this.geometry.getAttribute("size") as THREE.BufferAttribute;
    for (let i = 0; i < this.planets.length; i += 1) this.sizes[i] = this.baseSizes[i];
    attr.needsUpdate = true;
  }

  // --- Timeline -------------------------------------------------------------

  setYear(year: number): void {
    this.yearFilter = year;
    if (!this.geometry) return;
    for (let i = 0; i < this.planets.length; i += 1) {
      this.targetVisibility[i] = this.planets[i].planet.disc_year <= year ? 1 : 0;
    }
  }

  // --- Interaction ----------------------------------------------------------

  onHoverChange(cb: (p: DerivedPlanet | null, event: PointerEvent) => void): void { this.onHover = cb; }
  onSelectPlanet(cb: (p: DerivedPlanet) => void): void { this.onSelect = cb; }

  focusPlanet(index: number, fly = true): void {
    const target = this.pickables[index];
    if (!target) return;
    this.selectedIndex = index;
    this.highlight.visible = true;
    this.highlight.position.copy(target.position);
    this.selectionRing.visible = true;
    this.selectionRing.position.copy(target.position);
    this.selectionRing.lookAt(this.camera.position);
    if (fly && this.controls) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      if (dir.lengthSq() < 0.001) dir.set(0, 0.4, 1).normalize();
      this.controls.target.copy(target.position);
      this.camera.position.copy(target.position).add(dir.multiplyScalar(2.4));
    }
  }

  clearFocus(): void {
    this.selectedIndex = -1;
    this.highlight.visible = false;
    this.selectionRing.visible = false;
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    if (!this.points) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Points have no volume, so pick against a padded threshold that scales with zoom.
    this.raycaster.params.Points = { threshold: Math.max(2.2, this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3()) * 0.012) };
    const hits = this.raycaster.intersectObject(this.points, false);
    let index = -1;
    for (const hit of hits) {
      const i = hit.index ?? -1;
      if (i >= 0 && this.visibility[i] > 0.5) { index = i; break; }
    }
    if (index !== this.hoveredIndex) {
      this.hoveredIndex = index;
      this.renderer.domElement.style.cursor = index >= 0 ? "pointer" : "grab";
      this.onHover?.(index >= 0 ? this.planets[index] : null, event);
    } else if (index >= 0) {
      this.onHover?.(this.planets[index], event);
    }
  };

  private handlePointerLeave = (): void => {
    this.hoveredIndex = -1;
    this.onHover?.(null, null as unknown as PointerEvent);
  };

  private handleClick = (): void => {
    if (this.hoveredIndex >= 0) this.onSelect?.(this.planets[this.hoveredIndex]);
  };

  // --- Loop -----------------------------------------------------------------

  private handleResize = (): void => {
    if (this.disposed || !this.container.clientWidth || !this.container.clientHeight) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
    if (this.material) this.material.uniforms.uScale.value = h * 0.2;
  };

  private animate(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);

    // Adaptive quality: drop bloom if we cannot hold ~45fps.
    const last = this.lastFrame ?? now;
    const dt = now - last;
    this.lastFrame = now;
    if (dt > 0 && dt < 500) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length > 90) {
        this.frameTimes.shift();
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        if (avg > 26 && this.post) { this.post.dispose(); this.post = null; }
        else if (avg < 15 && !this.post && this.bloomEnabled && this.frameTimes.length === 90) {
          try { this.post = createComposer(this.renderer, this.scene, this.camera, { strength: 0.7, radius: 0.45, threshold: 0.1 }); } catch { this.post = null; }
        }
      }
    }

    // Ease the timeline reveal.
    if (this.geometry) {
      let changed = false;
      const attr = this.geometry.getAttribute("visibility") as THREE.BufferAttribute;
      for (let i = 0; i < this.visibility.length; i += 1) {
        const diff = this.targetVisibility[i] - this.visibility[i];
        if (Math.abs(diff) > 0.002) { this.visibility[i] += diff * 0.14; changed = true; }
      }
      if (changed) attr.needsUpdate = true;
    }

    if (this.selectedIndex >= 0 && this.selectionRing.visible) {
      this.selectionRing.lookAt(this.camera.position);
      const pulse = 1 + Math.sin(now * 0.003) * 0.12;
      this.selectionRing.scale.setScalar(9 * pulse);
      const ringMaterial = this.selectionRing.material as THREE.LineBasicMaterial;
      ringMaterial.opacity = 0.6 + Math.sin(now * 0.003) * 0.25;
    }

    if (this.sun && !this.reduced) {
      this.sun.children.forEach((child) => {
        if (child instanceof THREE.Sprite) child.material.rotation += 0.0009;
      });
    }

    this.controls?.update();
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private lastFrame?: number;
  private controlsTargetHint = new THREE.Vector3();

  // --- Lifecycle ------------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.handleResize);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.controls?.dispose();
    this.post?.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
        return;
      }
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
        object.geometry?.dispose();
        const material = object.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  get cameraPosition(): THREE.Vector3 { return this.camera.position; }
  get colorModeValue(): ColorMode { return this.colorMode; }
  get sizeModeValue(): SizeMode { return this.sizeMode; }

  /** Called when the galaxy view becomes visible again after a hidden tab. */
  resizeIfNeeded(): void { this.handleResize(); }

  /** Diagnostics: how much of the catalogue is genuinely on screen right now. */
  debugState(): unknown {
    // updateMatrixWorld first: matrixWorldInverse is stale until the renderer
    // refreshes the camera, and a stale frustum reports nonsense.
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix, this.camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(matrix);
    let inFrustum = 0;
    const projected: number[] = [];
    let minSize = Infinity; let maxSize = 0;
    for (let i = 0; i < this.planets.length; i += 1) {
      const point = this.pickables[i]?.position;
      if (!point) continue;
      if (frustum.containsPoint(point)) inFrustum += 1;
    }
    for (const size of this.sizes) {
      if (size < minSize) minSize = size;
      if (size > maxSize) maxSize = size;
    }
    const canvasHeight = this.container.clientHeight;
    const camDistance = this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3());
    projected.push(
      1, 2, 3,
    );
    return {
      camera: this.camera.position.toArray().map((v) => +v.toFixed(2)),
      target: (this.controls?.target ?? new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)),
      camDistance: +camDistance.toFixed(2),
      fov: this.camera.fov,
      inFrustum,
      total: this.planets.length,
      sizeRange: [+minSize.toFixed(3), +maxSize.toFixed(3)],
      uScale: this.material?.uniforms.uScale.value,
      // Pixel size a mid-range world would occupy at the target depth.
      samplePixelSize: +((3 * (this.material?.uniforms.uScale.value ?? 0)) / Math.max(camDistance, 0.001)).toFixed(2),
      // [r05,r25,r50,r75,r95,r999, n(<10),n(<20),n(<40),n(<60),n(<74), y50,y95]
      radialStats: this.sampleExtent(),
      projection: this.projectionStats(),
      angular: this.angularStats(),
      portal: this.portal,
      ringsPresent: !!this.rings,
      structurePresent: !!this.structure,
      structureChildren: this.structure?.children.map((c) => c.name || c.type),
      canvasHeight,
    };
  }

  /** Projects every world to NDC and reports how many land inside the viewport. */
  private projectionStats(): Record<string, number> {
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    let onScreen = 0;
    let behind = 0;
    let nearMiss = 0;
    const ndcX: number[] = [];
    const v = new THREE.Vector3();
    for (const pick of this.pickables) {
      v.copy(pick.position).project(this.camera);
      if (v.z > 1 || v.z < -1) { behind += 1; continue; }
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) {
        onScreen += 1;
        ndcX.push(v.x);
      } else if (Math.abs(v.x) <= 3 && Math.abs(v.y) <= 3) {
        nearMiss += 1;
      }
    }
    ndcX.sort((a, b) => a - b);
    const q = (p: number) => +(ndcX[Math.floor(ndcX.length * p)] ?? 0).toFixed(2);
    // Where on screen the visible worlds land: 0 = far left, 1 = far right.
    const buckets = [0, 0, 0, 0, 0];
    for (const x of ndcX) buckets[Math.min(4, Math.floor(((x + 1) / 2) * 5))] += 1;
    return {
      onScreen,
      behind,
      nearMiss,
      ndcQ05: q(0.05), ndcQ25: q(0.25), ndcQ50: q(0.5), ndcQ75: q(0.75), ndcQ95: q(0.95),
      screenSpread: +(q(0.95) - q(0.05)).toFixed(2),
      columnHistogram: buckets.join("|") as unknown as number,
    };
  }

  /** Angular histogram around the view axis, to see where the cloud actually sits. */
  private angularStats(): Record<string, number> {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const toPoint = new THREE.Vector3();
    let within30 = 0; let within60 = 0; let within90 = 0; let behind = 0;
    let minAngle = 999; let total = 0;
    for (const pick of this.pickables) {
      toPoint.copy(pick.position).sub(this.camera.position);
      const len = toPoint.length();
      if (len < 1e-6) continue;
      total += 1;
      const cos = toPoint.divideScalar(len).dot(forward);
      if (cos < 0) { behind += 1; continue; }
      const angle = THREE.MathUtils.radToDeg(Math.acos(Math.min(cos, 1)));
      if (angle < minAngle) minAngle = angle;
      if (angle <= 30) within30 += 1;
      else if (angle <= 60) within60 += 1;
      else if (angle <= 90) within90 += 1;
    }
    return {
      total,
      within30,
      within60,
      within90,
      behindCamera: behind,
      minAngleDeg: +minAngle.toFixed(2),
    };
  }

  private sampleExtent(): number[] {
    const radii: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < this.positions.length; i += 3) {
      radii.push(Math.hypot(this.positions[i], this.positions[i + 1], this.positions[i + 2]));
      ys.push(Math.abs(this.positions[i + 1]));
    }
    radii.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => +arr[Math.floor(arr.length * p)].toFixed(2);
    const within = (limit: number) => radii.filter((r) => r <= limit).length;
    return [
      q(radii, 0.05), q(radii, 0.25), q(radii, 0.5), q(radii, 0.75), q(radii, 0.95), q(radii, 0.999),
      within(10), within(20), within(40), within(60), within(74),
      q(ys, 0.5), q(ys, 0.95),
    ];
  }
}

// --- Module helpers ---------------------------------------------------------

function extent(values: (number | null)[]): [number, number] {
  let lo = Infinity; let hi = -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v) || v <= 0) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [1, 10];
  return [lo, hi];
}

function makeGlowTexture(color: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color.replace(")", ",0.55)").replace("rgb", "rgba"));
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Cached positions for the named nearby stars, reused by the label layer. */
const NEARBY_STARS_CACHE = NEARBY_STARS.map((star) => ({
  ...star,
  color: starColorFor(star.teff),
  position: new THREE.Vector3(star.x * 0.185, star.z * 0.185, star.y * 0.185),
}));

export { NEARBY_STARS_CACHE };
