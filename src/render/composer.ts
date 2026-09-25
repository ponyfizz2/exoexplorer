/**
 * Shared post-processing stack.
 *
 * Bloom is what makes points read as "stars" rather than "pixels", but it is
 * also the most expensive thing in the scene — so it is opt-in and can be
 * downgraded at runtime by the renderer when frame time slips.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface ComposerHandle {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  render: () => void;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
}

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { strength?: number; radius?: number; threshold?: number } = {},
): ComposerHandle {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    options.strength ?? 0.85,
    options.radius ?? 0.5,
    options.threshold ?? 0.12,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    composer,
    bloom,
    render: () => composer.render(),
    setSize: (w: number, h: number) => composer.setSize(w, h),
    dispose: () => {
      composer.dispose();
      bloom.dispose();
    },
  };
}

/** Cheap capability probe used to decide whether bloom is affordable. */
export function shouldUseBloom(): boolean {
  const small = Math.min(window.innerWidth, window.innerHeight) < 900;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return !(small && coarse) && cores >= 4;
}
