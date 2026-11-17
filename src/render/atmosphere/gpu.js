// Small GPU helpers shared by the pipeline, atmosphere and clouds. OWNER: atmosphere agent.
import * as THREE from 'three';
import { GLSL_FULLSCREEN_VERT } from '../shaders/common.glsl.js';

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
TRI.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
const CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** ShaderMaterial for a fullscreen pass (GLSL ES 3.00, explicit `out vec4 outColor`). */
export function fsMaterial({ fragmentShader, uniforms = {}, defines = {}, blending = THREE.NoBlending, transparent = false, vertexShader = GLSL_FULLSCREEN_VERT }) {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    blending,
    transparent,
    toneMapped: false,
  });
  return m;
}

/** Fullscreen triangle pass. render(renderer, target, viewport?) draws `material` into target. */
export class FullscreenPass {
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(TRI, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.add(this.mesh);
  }
  // viewport = [x, y, w, h] in target pixels (the renderer copies target.viewport in setRenderTarget)
  render(renderer, target, viewport = null, layer = 0) {
    if (viewport && target) target.viewport.set(viewport[0], viewport[1], viewport[2], viewport[3]);
    renderer.setRenderTarget(target, layer);
    if (viewport && !target) renderer.setViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    renderer.render(this.scene, CAM);
    if (viewport && target) target.viewport.set(0, 0, target.width, target.height);
  }
  dispose() { this.material.dispose(); }
}

export function halfFloatTarget(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.NoColorSpace,
    ...opts,
  });
}

/** Seed derived from the world seed for GPU hashes (uint). */
export function gpuSeed(seed, channel) {
  let h = (seed ^ Math.imul(channel + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
