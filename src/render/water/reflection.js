// Planar reflection for the dominant water plane near a low camera. OWNER: water agent.
//
// When the camera is below ~2.5 km above a large water body, the scene (minus the water) is rendered
// once per frame from the camera mirrored about the tangent plane of that body's level (oblique near
// clip at the plane, jitter / view offset mirrored like three's Reflector) into a mipmapped half-float
// target with a depth texture. The water material reads the reflected object's distance D from the depth,
// re-projects the ray through the (scaled) wave normal at that distance (wave distortion), blurs it with an
// anisotropic kernel (long axis = elevation) whose angular width comes from the unresolved wave slopes and
// shrinks with D / (D + distance) (contact hardening: sharp at the far waterline, streaking / merging and
// fading into the sky reflection away from it), hazes the reflected geometry by D and blends it over the
// sky environment; water at other levels (canals, reservoirs) keeps the environment reflection.
// The render happens in the onBeforeRender of the first water mesh drawn in the main scene pass, so
// every system has already placed its objects for this frame (nested render, like THREE.Reflector).
import * as THREE from 'three';

const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _view = new THREE.Vector3(), _look = new THREE.Vector3();
const _target = new THREE.Vector3(), _rot = new THREE.Matrix4(), _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
const _camPos = new THREE.Vector3();

export class PlanarReflection {
  constructor(app, shared) {
    this.app = app;
    this.u = shared;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = true;
    this.rt = null;
    this.scale = 0.75;
    this.active = false;
    this.renderedFrame = -1;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.point = new THREE.Vector3();
    this.level = 0;
    this.hide = [];            // objects hidden while rendering the reflection
    this.calls = 0;
  }

  _ensureTarget() {
    const pl = this.app.pipeline;
    const W = Math.max(64, Math.round((pl?.width || 1600) * this.scale));
    const H = Math.max(64, Math.round((pl?.height || 900) * this.scale));
    if (this.rt && this.rt.width === W && this.rt.height === H) return;
    this.rt?.depthTexture?.dispose();
    this.rt?.dispose();
    const depth = new THREE.DepthTexture(W, H, THREE.FloatType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter; depth.magFilter = THREE.NearestFilter;
    // mipmapped (fix round 3, W1): the water shader blurs the reflection with distance / wave slope (anisotropic
    // kernel along the elevation, mip level from its short axis); three regenerates the chain after every render
    this.rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      depthBuffer: true, depthTexture: depth,
    });
    this.rt.texture.name = 'water.planar';
    this.u.uWtrPlanarTex.value = this.rt.texture;
    this.u.uWtrPlanarDepth.value = depth;
  }

  /** set the plane for this frame (render space point + unit normal + level) or disable */
  configure(on, point, normal, level) {
    this.active = !!on;
    if (!on) { this.u.uWtrPlanarOn.value = 0; return; }
    this.point.copy(point); this.normal.copy(normal); this.level = level;
    this.u.uWtrPlanarLevel.value = level;
  }

  /** called from a water mesh's onBeforeRender inside the main scene pass */
  render(renderer, scene, camera, frameNo) {
    if (!this.active || this.renderedFrame === frameNo) return;
    this.renderedFrame = frameNo;
    if (camera !== this.app.camera) return;         // only for the main view
    this._ensureTarget();
    const rc = this.camera;
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _n.copy(this.normal);
    _p.copy(this.point);
    _view.subVectors(_p, _camPos);
    if (_view.dot(_n) > 0) { this.u.uWtrPlanarOn.value = 0; return; }   // camera below the plane
    _view.reflect(_n).negate().add(_p);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.subVectors(_p, _look).reflect(_n).negate().add(_p);
    rc.position.copy(_view);
    rc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
    rc.lookAt(_target);
    rc.near = camera.near; rc.far = camera.far;
    rc.updateMatrixWorld(true);
    rc.projectionMatrix.copy(camera.projectionMatrix);
    rc.projectionMatrix.elements[8] *= -1;
    rc.projectionMatrix.elements[12] *= -1;
    // texture lookup matrix (before the oblique clip: the depth / projection the shader decodes)
    this.u.uWtrPlanarVP.value.multiplyMatrices(rc.projectionMatrix, rc.matrixWorldInverse);
    this.u.uWtrPlanarFwd.value.set(0, 0, -1).applyQuaternion(rc.quaternion);
    this.u.uWtrPlanarLogFar.value = Math.log2(rc.far + 1);
    // oblique near plane = the water plane (Lengyel)
    _plane.setFromNormalAndCoplanarPoint(_n, _p);
    _plane.applyMatrix4(rc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = rc.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + pm[8]) / pm[0];
    _q.y = (Math.sign(_clip.y) + pm[9]) / pm[5];
    _q.z = -1.0;
    _q.w = (1.0 + pm[10]) / pm[14];
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    pm[2] = _clip.x; pm[6] = _clip.y; pm[10] = _clip.z + 1.0 - 0.0; pm[14] = _clip.w;
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();

    const vis = this.hide.map((o) => o.visible);
    for (const o of this.hide) o.visible = false;
    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevNeeds = renderer.shadowMap.needsUpdate;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    try { renderer.render(scene, rc); } catch (e) { if (!this._warned) { this._warned = true; console.warn('[water] planar reflection failed', e); } }
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.shadowMap.needsUpdate = prevNeeds;
    renderer.setRenderTarget(prevRT);
    this.hide.forEach((o, i) => { o.visible = vis[i]; });
    this.u.uWtrPlanarOn.value = 1;
    this.calls++;
  }

  dispose() { this.rt?.depthTexture?.dispose(); this.rt?.dispose(); }
}
