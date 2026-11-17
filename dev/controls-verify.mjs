#!/usr/bin/env node
// Controls verification runner (OWNER: controls agent).
//   node dev/controls-verify.mjs [--base http://127.0.0.1:5173 | --serve 5186] [--suite all|numeric|visual|main] [--out shots/controls]
//   --serve <port> starts a private Vite server without HMR (other engineers' edits cannot reload the
//   page mid-test) for the duration of the run.
// numeric: runs window.__BENCH__.tests on dev/controls.html and prints JSON results + pass/fail
// visual:  screenshot sequences (orbit dive, walk through the house, focus views) from the bench
// main:    drives the real app (index.html) with synthetic input + controls APIs (needs a working app)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../scripts/chrome.mjs';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
let base = opt('base', process.env.MARS_BASE || 'http://127.0.0.1:5173');
let server = null;
if (opt('serve')) {
  const { createServer } = await import('vite');
  const { fileURLToPath } = await import('url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = +opt('serve');
  server = await createServer({ configFile: false, root, base: '/', logLevel: 'error', worker: { format: 'es' },
    server: { port, strictPort: true, host: '127.0.0.1', hmr: false, fs: { allow: [path.resolve(root, '..')] } } });
  await server.listen();
  base = `http://127.0.0.1:${port}`;
}
const suite = opt('suite', 'all');
const outDir = opt('out', 'shots/controls');
const W = +opt('width', 1600), H = +opt('height', 900);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const report = { base, suite, results: {}, checks: [], errors: [] };
// partial results survive a hung / killed run (shots/<out>/report-<suite>.json, every 5 s), and a
// watchdog ends a run that stalls (e.g. the browser died under machine load)
const saveReport = () => { try { fs.writeFileSync(path.join(outDir, `report-${suite}.json`), JSON.stringify(report, null, 1)); } catch { /* */ } };
const saver = setInterval(saveReport, 5000);
const watchdog = setTimeout(() => { report.errors.push('watchdog: run exceeded ' + opt('maxMin', '55') + ' min'); saveReport(); process.exit(2); }, +opt('maxMin', '55') * 60000);

async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('pageerror', (e) => report.errors.push(String(e.stack || e)));
  await page.goto(base + url, { waitUntil: 'load', timeout: 400000 });
  await page.waitForFunction(() => window.__MARS__ && window.__MARS__.ready, null, { timeout: 400000 });
  return { ctx, page };
}
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); };
const shot = async (page, name) => { const f = path.join(outDir, name); try { await page.screenshot({ path: f, timeout: 120000 }); } catch (e) { report.errors.push(`screenshot ${name}: ${e.message.split("\n")[0]}`); } return f; };

try {
  if (suite === 'all' || suite === 'numeric') {
    const { ctx, page } = await open('/dev/controls.html');
    const run = (expr) => page.evaluate(`(async () => { const B = window.__BENCH__; const c = B.app.controls; ${expr} })()`);
    const R = report.results;
    R.zoomIn = await run('return await B.tests.zoom({})');
    R.zoomOut = await run('return await B.tests.zoom({ delta: 100, notches: 5 })');
    R.zoomOrbit = await run(`await c.flyTo({ lat: 15, lon: 100, alt: 9.5e6, heading: 0, pitch: -90 }, { duration: 0.5 }); await B.until(() => c.isIdle(), 3000);
      const a = await B.tests.zoom({ notches: 25 }); const p1 = B.app.rig.getPose();
      const rc = B.app.renderer.domElement.getBoundingClientRect();
      const b = await B.tests.zoom({ x: rc.left + rc.width * 0.2, y: rc.top + rc.height * 0.3, notches: 30 });
      const z = await B.tests.zoom({ x: rc.left + rc.width * 0.8, y: rc.top + rc.height * 0.75, notches: 25, delta: 100 });
      await c.flyTo({ lat: 22.0, lon: 118.0, alt: 400, heading: 0, pitch: -38 }, { duration: 0.6 }); await B.until(() => c.isIdle(), 3000);
      return { a, b, out: z, pitchAfterA: p1.pitch }`);
    R.pinch = await run('return await B.tests.zoom({ delta: -20, notches: 6, ctrl: true })');
    R.landing = await run(`const p0 = B.app.rig.getPose().pitch; const rc = B.app.renderer.domElement.getBoundingClientRect();
      for (let i = 0; i < 40; i++) { B.wheel(rc.left + rc.width / 2, rc.top + rc.height / 2, -120); await B.frames(2); }
      await B.until(() => c.isIdle(), 6000); const p = B.app.rig.getPose(); return { pitch0: p0, pitch1: p.pitch, hAG: c.heightAboveGround(true) }`);
    R.dragLow = await run("await c.flyTo({ lat: 21.996, lon: 118.0, alt: 420, heading: 0, pitch: -38 }, { duration: 0.5 }); await B.until(() => c.isIdle(), 3000); return await B.tests.drag({})");
    R.dragGround = await run(`const p = B.localToEcef(-250, 700, B.hLocal(-250, 700) + 1.7); const r = p.length();
      const lat = Math.asin(p.y / r) * 180 / Math.PI, lon = Math.atan2(p.x, p.z) * 180 / Math.PI;
      await c.flyTo({ lat, lon, alt: r - 3389500, heading: 10, pitch: -12 }, { duration: 0.5 }); await B.frames(4); await B.until(() => c.isIdle(), 3000);
      const rc = B.app.renderer.domElement.getBoundingClientRect();
      return await B.tests.drag({ x0: rc.left + rc.width * 0.5, y0: rc.top + rc.height * 0.8, x1: rc.left + rc.width * 0.35, y1: rc.top + rc.height * 0.62 })`);
    R.drag2000km = await run("await c.flyTo({ lat: 22, lon: 118, alt: 2.0e6, heading: 0, pitch: -90 }, { duration: 0.8 }); return await B.tests.drag({})");
    R.drag9000km = await run("await c.flyTo({ lat: 10, lon: 100, alt: 9.0e6, heading: 0, pitch: -90 }, { duration: 0.8 }); return await B.tests.drag({})");
    R.dragPole = await run(`await c.flyTo({ lat: 84, lon: 30, alt: 1.2e6, heading: 0, pitch: -90 }, { duration: 0.8 });
      const rc = B.app.renderer.domElement.getBoundingClientRect(); let worst = 0; const poses = [];
      for (let k = 0; k < 4; k++) { const r = await B.tests.drag({ x0: rc.left + rc.width * 0.5, y0: rc.top + rc.height * 0.25, x1: rc.left + rc.width * 0.5, y1: rc.top + rc.height * 0.75 }); worst = Math.max(worst, r.pxErrMax); poses.push(B.app.rig.getPose()); }
      return { pxErrMax: worst, lats: poses.map((p) => +p.lat.toFixed(2)), rolls: poses.map((p) => +p.roll.toFixed(4)), valid: B.app.rig.isValid() }`);
    R.rotate = await run(`await c.flyTo({ lat: 22.0, lon: 118.0, alt: 1500, heading: 0, pitch: -60 }, { duration: 0.8 });
      const before = c.centerTarget(true).clone();
      await B.tests.drag({ button: 2 });
      const after = c.centerTarget(true);
      const p = B.app.rig.getPose();
      return { pivotShift: before.distanceTo(after), heading: p.heading, pitch: p.pitch, roll: p.roll }`);
    R.flyNear = await run('return await B.tests.flyto({ lat: 22.001, lon: 118.0005, alt: 80, heading: 30, pitch: -20 })');
    R.flyFar = await run('return await B.tests.flyto({ lat: -40, lon: -60, alt: 3.0e6, heading: 200, pitch: -70, lens: 50 })');
    R.flyGround = await run('return await B.tests.flyto({ lat: 22.0004, lon: 118.0, alt: 21.65, heading: 0, pitch: -3, lens: 28 })');
    R.flyInterrupt = await run(`const p = c.flyTo({ lat: 30, lon: 140, alt: 5e5, heading: 0, pitch: -90 }); await B.frames(20);
      B.wheel(800, 450, -100); const r = await p; return { arrived: r.arrived, interrupted: r.interrupted, transition: !!c.transition }`);
    R.back = await run('return await B.tests.back()');
    R.walkHouse = await run('return await B.tests.walkHouse()');
    R.walkSteps = await run('return await B.tests.walkSteps()');
    R.walkSlopes = await run('return await B.tests.walkSlopes()');
    R.focus = await run('const r = await B.tests.focus(); await B.frames(10); r.enter.feetAfter = +(c.modes.walk.info.feetH - 20).toFixed(3); return r');
    R.walkPond = await run('return await B.tests.walkPond()');
    R.fly = await run('return await B.tests.fly()');
    R.walkTo = await run('return await B.tests.walkTo()');
    R.touch = await run('return await B.tests.touch()');
    R.flights = await run('return await B.tests.flights()');
    R.dive = await run("await c.flyTo({ lat: 22.012, lon: 118.004, alt: 9.0e6, heading: 0, pitch: -90 }, { duration: 0.8 }); return await B.tests.dive({ notches: 130 })");
    R.diveTower = await run(`const city = B.app.systems.city, b = city.byId.get('B4'); await c.flyTo({ lookAt: city.localToWorld(b, [0, 30, -10]), range: 600, heading: 0, tilt: 70 }, { duration: 0.8 });
      const rc = B.app.renderer.domElement.getBoundingClientRect(); for (let i = 0; i < 60; i++) { B.wheel(rc.left + rc.width / 2, rc.top + rc.height / 2, -120); await B.frames(2); }
      await B.until(() => c.isIdle(), 6000); const l = B.localOf(b, B.app.rig.position); return { gapToSouthFacade: +(-10 - l.z).toFixed(3), y: +l.y.toFixed(2) }`);
    R.tab = await run(`await c.flyTo({ lat: 22.0, lon: 118.0, alt: 300, heading: 0, pitch: -45 }, { duration: 0.6 });
      const seq = []; for (let i = 0; i < 3; i++) { B.key('Tab', true); B.key('Tab', false); await B.until(() => c.isIdle(), 8000); await B.frames(5); seq.push(c.modeName); }
      return { seq, hAG: +c.heightAboveGround(true).toFixed(3) }`);
    R.pick = await run(`await c.flyTo({ lat: 21.9985, lon: 118.0, alt: 160, heading: 0, pitch: -40 }, { duration: 0.5 }); await B.frames(4);
      const city = B.app.systems.city; const sel = []; const hov = [];
      const off1 = B.app.events.on('select', (s) => sel.push(s)); const off2 = B.app.events.on('hover', (h) => hov.push(h));
      const pB = B.project(city.localToWorld(city.byId.get('B4'), [0, 30, -10]));
      B.ptr('pointerdown', pB.x, pB.y); B.ptr('pointerup', pB.x, pB.y); await B.frames(30);
      const pT = B.project(B.localToEcef(-60, 30, B.hLocal(-60, 30)));
      B.ptr('pointerdown', pT.x, pT.y); B.ptr('pointerup', pT.x, pT.y); await B.frames(30);
      B.app.renderer.domElement.dispatchEvent(new PointerEvent('pointermove', { clientX: pB.x, clientY: pB.y, pointerType: 'mouse', buttons: 0, bubbles: true }));
      await B.frames(30); off1(); off2();
      const s0 = sel[0], s1 = sel[1], h0 = hov[hov.length - 1];
      return { first: s0 && { type: s0.type, id: s0.id }, second: s1 && { type: s1.type, province: s1.province, zone: s1.zone, h: +(s1.h || 0).toFixed(2) }, hover: h0 && { type: h0.type, id: h0.id } }`);
    R.deferMode = await run(`const arrive = []; const off = B.app.events.on('camera:arrive', (e) => arrive.push(e));
      const p = c.flyTo({ lat: 22.0004, lon: 118.0, alt: 21.65, heading: 0, pitch: 0 }, {}); const bm = { id: 'TEST', pose: {} };
      c.setMode('walk', { bookmark: bm }); const during = c.modeName; const r = await p; await B.frames(5); off();
      return { during, after: c.modeName, arrived: r.arrived, bookmark: arrive[0] && arrive[0].bookmark && arrive[0].bookmark.id }`);
    R.escFocus = await run(`await c.focusBuilding('B2'); const m1 = c.modeName; B.key('Escape', true); B.key('Escape', false); await B.frames(3); return { m1, m2: c.modeName }`);
    R.perf = await run('return { controlsMsEMA: +c.perf.ms.toFixed(3), controlsMsMax: +c.perf.max.toFixed(2) }');
    R.nanGuard = await run(`const g = B.app.rig.snapshot(); B.app.rig.position.x = NaN; B.app.rig.touch(); await B.frames(3); return { valid: B.app.rig.isValid(), restored: B.app.rig.equals(g, 1, 1) }`);
    R.keys = await run(`await c.flyTo({ lat: 22.0, lon: 118.0, alt: 2000, heading: 0, pitch: -50 }, { duration: 0.6 });
      const p0 = B.app.rig.getPose(); B.key('KeyW', true); await B.frames(40); B.key('KeyW', false); await B.until(() => c.isIdle(), 4000);
      const p1 = B.app.rig.getPose(); B.key('KeyE', true); await B.frames(30); B.key('KeyE', false); await B.until(() => c.isIdle(), 4000);
      const p2 = B.app.rig.getPose(); B.key('KeyN', true); B.key('KeyN', false); await B.until(() => c.isIdle(), 4000);
      const p3 = B.app.rig.getPose(); B.key('KeyU', true); B.key('KeyU', false); await B.until(() => c.isIdle(), 4000);
      const p4 = B.app.rig.getPose();
      return { movedNorth_m: +((p1.lat - p0.lat) * 59158).toFixed(1), headingAfterE: +p2.heading.toFixed(1), headingAfterN: +p3.heading.toFixed(2), pitchAfterU: +p4.pitch.toFixed(2) }`);
    R.walkHouseAnchor = await run('return await B.tests.walkHouseAnchor()');
    R.skyWheel = await run('return await B.tests.skyWheel()');
    R.agl = await run('return await B.tests.agl()');
    R.path = await run('return await B.tests.path()');
    R.focusKeep = await run('return await B.tests.focusKeep()');
    R.modeShown = await run('return await B.tests.modeShown()');
    R.unknown = await run('return await B.tests.unknown()');
    R.views = await run('return await B.tests.views()');
    R.keysMisc = await run('return await B.tests.keysMisc()');
    R.keyRules = await run('return await B.tests.keyRules()');
    R.glide = await run('return await B.tests.glide()');
    R.wallGuard = await run('return await B.tests.wallGuard()');
    await ctx.close();

    const V = R.views;
    check('building viewpoints from the city anchors: street / lobby / upper floor / roof / back, walking on each floor; spec-only street view synthesised',
      V.street.mode === 'walk' && Math.abs(V.street.eyeY - 1.65) < 0.02 && V.lobby.view === 'lobby' && Math.abs(V.lobby.feetY - 0.15) < 0.02 && V.living.view === 'living' && Math.abs(V.living.feetY - 3.3) < 0.02 &&
      Math.abs(V.roof.feetY - 6.5) < 0.02 && V.back.mode === 'walk' && V.specStreet.mode === 'walk' && Math.abs(V.specStreet.eyeAboveGround - 1.65) < 0.03 && V.specStreet.facing > 0.95, V);
    check('entering a room from the street passes through the doorway', V.lobby.frontCrossing && Math.abs(V.lobby.frontCrossing.x) < 0.6 && V.lobby.frontCrossing.y > 0.5 && V.lobby.frontCrossing.y < 2.3, V.lobby);
    check('digits stay with the UI outside focus mode; orbit key pan 12–28°/s at 9,500 km; fly Shift ×10 / Alt ÷10; back() after a mode switch is instant',
      !R.keysMisc.digitPreventedInOrbit && R.keysMisc.orbitPanDegPerSec > 12 && R.keysMisc.orbitPanDegPerSec < 28 && Math.abs(R.keysMisc.fly.shift - 10) < 0.5 && Math.abs(R.keysMisc.fly.alt - 0.1) < 0.01 &&
      R.keysMisc.backSamePose.arrived && R.keysMisc.backSamePose.mode === 'orbit' && R.keysMisc.backSamePose.ms < 200 && R.keysMisc.backSamePose.posErr < 1e-6, R.keysMisc);
    const K = R.keyRules;
    check('keyboard ownership: focus in #mars-ui keeps keys there; Tab cycles only after a press on the view; M cycles; Esc / Enter consumed only when they act; held keys released on focusin',
      !K.ui.tabPrevented && !K.ui.wPrevented && K.ui.mode === 'orbit' && !K.afterUiPress.tabPrevented && K.afterUiPress.mode === 'orbit' && K.viewTabPrevented &&
      K.seq.join(',') === 'fly,orbit,fly,orbit' && !K.escOrbitPrevented && K.escFocus.prevented && K.escFocus.mode === 'orbit' && !K.enterNoSelPrevented &&
      K.enterSel.prevented && K.enterSel.mode === 'focus' && K.heldReleased.heldBefore && !K.heldReleased.heldAfter, K);
    check('short eye-level flight glides (no rise, no backwards swing, exact); a long hop arcs', R.glide.near.kind === 'glide' && R.glide.near.maxHAG < 3 && R.glide.near.maxBackwards < 0.05 && R.glide.near.posErr < 1e-6 && R.glide.far.kind === 'arc', R.glide);
    check('walk: a building whose colliders are still loading is solid (stops one radius before the facade), then the capsule takes over',
      R.wallGuard.guardHits > 0 && Math.abs(R.wallGuard.withheldGapToFacade - 0.28) < 0.06 && Math.abs(R.wallGuard.capsuleGapToFacade - 0.28) < 0.06, R.wallGuard);

    check('colliders given as {anchor, quaternion}: same house walk (door → stairs → upper floor)', R.walkHouseAnchor.door && R.walkHouseAnchor.climb && Math.abs(R.walkHouseAnchor.upperFloorY - 3.3) < 0.02, R.walkHouseAnchor);
    check('street-level wheel on the sky glides forward and stays low', R.skyWheel.kind === 'sky' && R.skyWheel.horizontal > 5 && R.skyWheel.hAG < 4, R.skyWheel);
    check('agl pose: eye 1.65 m above the local ground', R.agl.arrived && R.agl.mode === 'walk' && Math.abs(R.agl.eye - 1.65) < 0.02, R.agl);
    check('flyPath: exact arrival, keeps moving through the waypoints', R.path.arrived && R.path.posErr < 1e-6 && R.path.angErr < 1e-6 && R.path.minMidSpeed > 1, R.path);
    check('bookmark focus keeps the framing (no snap) and presets re-centre on the building', R.focusKeep.ok && R.focusKeep.mode === 'focus' && R.focusKeep.posErr < 0.01 && R.focusKeep.angErrDeg < 0.05 && R.focusKeep.recentred < 0.05, R.focusKeep);
    check('walk drop: state.mode shows walk during the flight, interruption restores orbit', R.modeShown.during.shown === 'walk' && R.modeShown.during.active === 'orbit' && R.modeShown.after.shown === 'orbit' && R.modeShown.final.active === 'walk' && R.modeShown.final.shown === 'walk', R.modeShown);
    check('unknown building: focus / enter resolve false, mode restored', R.unknown.focus === false && R.unknown.enter === false && R.unknown.shownAfterFocus === R.unknown.active && R.unknown.shownAfterEnter === R.unknown.active, R.unknown);
    check('orbit-altitude zoom in/out keeps the cursor point fixed (< 0.5 px)', R.zoomOrbit.a.pxErrMax < 0.5 && R.zoomOrbit.b.pxErrMax < 0.5 && R.zoomOrbit.out.pxErrMax < 0.5, R.zoomOrbit);
    check('zoom keeps the cursor point fixed (< 0.5 px)', R.zoomIn.pxErrMax < 0.5 && R.zoomOut.pxErrMax < 0.5 && R.pinch.pxErrMax < 0.5, [R.zoomIn.pxErrMax, R.zoomOut.pxErrMax, R.pinch.pxErrMax]);
    check('wheel at the floor lands: clearance kept, view lifts towards the horizon', R.landing.hAG >= 1.69 && R.landing.pitch1 > -12 && R.landing.pitch1 < 0, R.landing);
    check('drag keeps the grabbed point under the cursor (< 0.5 px; ≤ 2 px riding bumpy ground at 1.7 m)', Math.max(R.dragLow.pxErrMax, R.drag2000km.pxErrMax, R.drag9000km.pxErrMax) < 0.5 && R.dragGround.pxErrMax <= 2, [R.dragLow.pxErrMax, R.dragGround.pxErrMax, R.drag2000km.pxErrMax, R.drag9000km.pxErrMax]);
    check('dragging over the pole: no flip, no roll, valid', R.dragPole.valid && R.dragPole.rolls.every((r) => Math.abs(r) < 0.01) && R.dragPole.pxErrMax < 0.5, R.dragPole);
    check('right-drag rotates about the screen-centre point', R.rotate.pivotShift < 0.5 && Math.abs(R.rotate.roll) < 0.01, R.rotate);
    check('flyTo arrives exactly', [R.flyNear, R.flyFar, R.flyGround].every((r) => r.arrived && r.posErr < 1e-6 && r.angErr < 1e-6), [R.flyNear, R.flyFar, R.flyGround]);
    check('flyTo is interruptible by input', !R.flyInterrupt.arrived && !R.flyInterrupt.transition, R.flyInterrupt);
    check('back() restores pose + mode exactly', R.back.arrived && R.back.modeOk && R.back.posErr < 1e-6 && R.back.angErr < 1e-6, R.back);
    check('walk: door → stairs → upper floor (3.30 m), feet on the ground', R.walkHouse.door && R.walkHouse.climb && Math.abs(R.walkHouse.upperFloorY - 3.3) < 0.02 && R.walkHouse.groundErrMax < 0.01, R.walkHouse);
    check('walk: 0.30 m steps climbable, 0.45 m blocked', R.walkSteps.stairsY >= 2.39 && Math.abs(R.walkSteps.lowBlockY - 0.3) < 0.01 && R.walkSteps.tallBlockY < 0.01, R.walkSteps);
    check('walk: slopes ≤ 40° walkable, steeper blocked', R.walkSlopes.ramp25Y > 2.9 && R.walkSlopes.ramp52Y < 0.5 && R.walkSlopes.terrain28Rise > 5 && R.walkSlopes.terrain52Rise < 1.5, R.walkSlopes);
    check('focus: back / roof views, enter → walk at the door', R.focus.arrived && R.focus.mode === 'focus' && Math.abs(((R.focus.backAz + 180) % 360) - 180) < 1 && Math.abs(R.focus.roofEl - 72) < 1 && R.focus.enter.mode === 'walk', R.focus);
    check('water: walking stops at the 0.6 m-deep shore; orbit stays 1.7 m above the water surface', Math.abs(R.walkPond.stopDistFromCentre - 20.3) < 1.2 && R.walkPond.orbitAltAboveWater >= 1.69 && R.walkPond.orbitAltAboveWater < 2.5, R.walkPond);
    check('fly: stays clear of facades (≥ 0.8 m) and ground (≥ 1.69 m)', R.fly.facadeGapMin >= 0.8 && R.fly.groundMin >= 1.69, R.fly);
    check('walk: double-click walks to the ground point', R.walkTo.mode === 'walk' && Math.abs(R.walkTo.x + 4) < 0.35 && Math.abs(R.walkTo.z - 10.5) < 0.35, R.walkTo);
    check('touch: pinch zooms, twist rotates, parallel swipe tilts', R.touch.zoomRatio > 1.5 && Math.abs(Math.abs(R.touch.headingDelta) - 30) < 6 && R.touch.pitchDelta > 5, R.touch);
    check('flight over the pole is smooth (< 200°/s peak turn rate), antipodal flight exact, ceiling 60,000 km', R.flights.polar.maxDegPerSec < 200 && !R.flights.polar.nan && R.flights.anti.posErr < 1e-6 && R.flights.ceilingKm <= 60000.001 && R.flights.ceilingKm > 40000, R.flights);
    check('dive 9000 km → ground: clearance 1.7 m, no NaN, no roll', R.dive.minHAG >= 1.69 && !R.dive.nan && Math.abs(R.dive.roll) < 0.01, R.dive);
    check('zooming into a tower facade stops 1.7 m before it', Math.abs(R.diveTower.gapToSouthFacade - 1.7) < 0.15, R.diveTower);
    check('Tab cycles orbit → fly → walk → orbit', R.tab.seq.join(',') === 'fly,walk,orbit', R.tab);
    check('click selects building / terrain location; hover reports the building', R.pick.first && R.pick.first.type === 'building' && R.pick.first.id === 'B4' && R.pick.second && R.pick.second.type === 'location' && R.pick.second.province >= 1 && R.pick.hover && R.pick.hover.id === 'B4', R.pick);
    check('bookmark-style setMode during a flight is applied on arrival (+ camera:arrive with bookmark)', R.deferMode.during !== 'walk' && R.deferMode.after === 'walk' && R.deferMode.arrived && R.deferMode.bookmark === 'TEST', R.deferMode);
    check('Esc leaves focus mode', R.escFocus.m1 === 'focus' && R.escFocus.m2 === 'orbit', R.escFocus);
    check('NaN guard restores the last valid pose', R.nanGuard.valid && R.nanGuard.restored, R.nanGuard);
    check('keyboard: W pans north, N north-up, U top-down', R.keys.movedNorth_m > 50 && Math.abs(((R.keys.headingAfterN + 180) % 360) - 180) < 0.5 && R.keys.pitchAfterU < -89, R.keys);
  }

  if (suite === 'all' || suite === 'visual') {
    const { ctx, page } = await open('/dev/controls.html');
    const run = (expr) => page.evaluate(`(async () => { const B = window.__BENCH__; const c = B.app.controls; ${expr} })()`);
    // orbit dive towards the site with the cursor on the house
    await run("await c.flyTo({ lat: 21.7, lon: 118.0, alt: 9.0e6, heading: 0, pitch: -90 }, { duration: 0.5 }); await B.frames(10)");
    await shot(page, 'v01_orbit_9000km.png');
    const target = await run("const p = B.localToEcef(0, 40, 22); const s = B.project(p); return { x: s.x, y: s.y }");
    const stops = [2e6, 2e5, 2e4, 2000, 300, 40, 4];
    let i = 2;
    for (const stop of stops) {
      await run(`const p = B.localToEcef(0, 40, 22); for (let k = 0; k < 400 && c.heightAboveGround(true) > ${stop}; k++) { const s = B.project(p); B.wheel(s.x, s.y, -100); await B.frames(2); } await B.until(() => c.isIdle(), 5000);`);
      await shot(page, `v${String(i++).padStart(2, '0')}_dive_${stop >= 1000 ? stop / 1000 + 'km' : stop + 'm'}.png`);
    }
    // rotate + tilt about the screen centre
    await run("await B.tests.drag({ button: 2, x0: 700, y0: 500, x1: 980, y1: 380 }); await B.until(() => c.isIdle(), 4000)");
    await shot(page, `v${String(i++).padStart(2, '0')}_rotate_tilt.png`);
    // focus + views
    await run("await c.focusBuilding('B1'); await B.until(() => c.isIdle(), 6000)");
    await shot(page, `v${String(i++).padStart(2, '0')}_focus_B1.png`);
    await run("B.key('Digit2', true); B.key('Digit2', false); await B.until(() => c.isIdle(), 5000)");
    await shot(page, `v${String(i++).padStart(2, '0')}_focus_back.png`);
    await run("B.key('Digit5', true); B.key('Digit5', false); await B.until(() => c.isIdle(), 5000)");
    await shot(page, `v${String(i++).padStart(2, '0')}_focus_roof.png`);
    await run("await c.enterBuilding('B1'); await B.frames(20)");
    await shot(page, `v${String(i++).padStart(2, '0')}_enter_door.png`);
    await run("await B.tests.walkHouse(); await B.frames(5)");
    await shot(page, `v${String(i++).padStart(2, '0')}_walk_upper_floor.png`);
    await run("c.modes.walk.setLook(180, -25); await B.frames(5)");
    await shot(page, `v${String(i++).padStart(2, '0')}_walk_look_down_stairs.png`);
    await run("await c.back(); await B.until(() => c.isIdle(), 8000)");
    await shot(page, `v${String(i++).padStart(2, '0')}_back.png`);
    // §5 shot-07 viewpoints of the house (walk mode at each)
    await run("c.setMode('orbit', { pushBack: false }); await c.focusBuilding('B1', { duration: 0.6 }); await B.until(() => c.isIdle(), 5000)");
    for (const v of ['street', 'lobby', 'living', 'roof', 'back']) {
      await run(`await c.buildingView('B1', '${v}', { duration: 0.8 }); await B.frames(12)`);
      await shot(page, `v${String(i++).padStart(2, '0')}_view_${v}.png`);
    }
    await ctx.close();
  }

  if (suite === 'script') {
    // ad-hoc probe: run a JS file (async body; B = __BENCH__ on the bench, app = the page's app,
    // c = its controls) in the bench page or (--page /?...) the main app
    const code = fs.readFileSync(opt('file'), 'utf8');
    const { ctx, page } = await open(opt('page', '/dev/controls.html'));
    page.on('console', (m) => { if (m.type() !== 'error') console.log('[page]', m.text()); });
    await page.evaluate(`(async () => { const B = window.__BENCH__ || null; const app = (B && B.app) || window.__MARS__.app; const c = app.controls; ${code} })()`);
    await ctx.close();
  }

  if (suite === 'descent') {
    // §1 逐级下降 in the real app: the cursor stays on one coastal city point from orbit to street level
    const { ctx, page } = await open('/?time=9.4&clean=1');
    const run = (expr) => page.evaluate(`(async () => { const app = window.__MARS__.app; const c = app.controls; const el = app.renderer.domElement;
      const frames = async (n = 1) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
      const until = async (fn, ms = 10000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await frames(1); } return false; };
      const rc = el.getBoundingClientRect();
      const proj = (p) => { const n = app.rig.projectNdc(p, rc.width / rc.height); return { x: rc.left + (n.x + 1) / 2 * rc.width, y: rc.top + (1 - n.y) / 2 * rc.height }; };
      ${expr} })()`);
    const lat = +opt('lat', 22.32), lon = +opt('lon', 118.64);
    await run(`await c.flyTo({ lat: ${lat} - 6, lon: ${lon} - 4, alt: 9.0e6, heading: 0, pitch: -90, lens: 50 }, { duration: 0.1 }); await window.__MARS__.waitIdle(30000, 6);`);
    await shot(page, 'd00_orbit.png');
    const stops = [[2.0e6, 'd01_2000km'], [3.0e5, 'd02_300km'], [5.0e4, 'd03_50km'], [1.0e4, 'd04_10km'], [2000, 'd05_2km'], [300, 'd06_300m'], [40, 'd07_40m'], [1.7, 'd08_ground']];
    const log = [];
    const T = await run(`const g = c.groundHeightAt(${lat}, ${lon}); const { latLonHToEcef } = await import('/src/core/geo.js'); const p = latLonHToEcef(${lat}, ${lon}, g); window.__DT__ = p; return p;`);
    for (const [h, name] of stops) {
      const r = await run(`const T = window.__DT__; let err = 0, n = 0;
        for (let k = 0; k < 600 && c.heightAboveGround(true) > ${h} * 1.02; k++) {
          const s = proj(T); const x = Math.round(s.x), y = Math.round(s.y);
          if (x < 0 || y < 0 || x > rc.width || y > rc.height) break;
          // the anchor is re-picked on the real surface; measure how far the target drifts from the cursor
          el.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: c.heightAboveGround() < ${h} * 6 ? -40 : -100, bubbles: true, cancelable: true }));
          await frames(2); const q = proj(T); err = Math.max(err, Math.hypot(q.x - x, q.y - y)); n++;
        }
        await until(() => c.isIdle(), 8000); await window.__MARS__.waitIdle(45000, 6);
        const p = app.rig.getPose(); return { stop: ${h}, notches: n, driftPxMax: Math.round(err * 100) / 100, hAG: Math.round(c.heightAboveGround(true) * 100) / 100, pitch: Math.round(p.pitch * 10) / 10, heading: Math.round(p.heading * 10) / 10 }`);
      log.push(r);
      await shot(page, name + '.png');
    }
    // at the floor: keep pushing in on the target (landing lifts the view, then the camera glides along the ground)
    const glide = await run(`const T = window.__DT__; let n = 0;
      for (let k = 0; k < 40; k++) { const s = proj(T); const x = Math.round(s.x), y = Math.round(s.y); if (x < 0 || y < 0 || x > rc.width || y > rc.height || s.depth <= 0) break;
        el.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: -100, bubbles: true, cancelable: true })); await frames(3); n++; }
      await until(() => c.isIdle(), 8000); await window.__MARS__.waitIdle(45000, 6);
      const P = app.rig.position; const u = Math.hypot(P.x, P.y, P.z); const up = { x: P.x / u, y: P.y / u, z: P.z / u };
      const d = { x: T.x - P.x, y: T.y - P.y, z: T.z - P.z }; const v = d.x * up.x + d.y * up.y + d.z * up.z;
      const p = app.rig.getPose();
      return { notches: n, horizontalToTarget: Math.round(Math.sqrt(Math.max(0, d.x * d.x + d.y * d.y + d.z * d.z - v * v)) * 100) / 100, hAG: Math.round(c.heightAboveGround(true) * 100) / 100, pitch: Math.round(p.pitch * 10) / 10 }`);
    await shot(page, 'd08b_glide.png');
    // street level: look around, then return to the same lat/lon in orbit (§1 再返回同一经纬度的轨道视角)
    await run(`await c.home({ duration: 3 }); await window.__MARS__.waitIdle(30000, 6);`);
    await shot(page, 'd09_home.png');
    report.results.descent = { target: { lat, lon }, stops: log, glide };
    check('descent: the target stays under the cursor from orbit to 40 m (drift < 3 px per stop)', log.slice(0, -1).every((r) => r.driftPxMax < 3), log);
    check('descent: lands 1.7 m above the ground, view lifted towards the horizon, then glides to the target', glide.hAG >= 1.69 && glide.hAG < 2.5 && glide.pitch > -20 && glide.horizontalToTarget < 12, glide);
    await ctx.close();
  }

  if (suite === 'bookmarks') {
    // D6 / fix round 1: every bookmark lands on its requested pose once the scene has refined. Like
    // scripts/capture-shots.mjs (fresh page per bookmark, goto(id, {instant}), waitIdle(…, 20)), plus
    // the pose sampled while streaming (transient lifts), the controls' held request and, for walking
    // arrivals, the floor under the feet (S07c: the 2nd-floor living room).
    const ids = opt('only', 'S05,S06,S07,S07b,S07c,S08b,S09c').split(',');
    const q = opt('query', '&workers=2');
    const idle = +opt('idle', 240000);
    const rows = [];
    for (const id of ids) {
      const t0 = Date.now();
      const { ctx, page } = await open(`/?clean=1${q}`);
      const row = { id };
      try {
        await page.evaluate(() => {
          window.__TRACE__ = []; const app = window.__MARS__.app; const tick = () => { const p = app.rig.getPose(); window.__TRACE__.push([Math.round(performance.now()), +p.alt.toFixed(2), app.controls.modeName]); if (window.__TRACE__.length < 20000) setTimeout(tick, 250); }; tick();
          // fix round 3 CT1: keep the controls' buildingView result (source 'city' | 'anchors' | 'spec' | 'bookmark', adjusted)
          const c = app.controls, bv = c.buildingView.bind(c);
          c.buildingView = async (...a) => { const r = await bv(...a); window.__BVR__ = r && typeof r === 'object' ? { arrived: r.arrived, interrupted: r.interrupted, view: r.view, source: r.source, mode: r.mode, adjusted: r.adjusted || null, requested: r.requested } : r; return r; };
        });
        row.goto = await Promise.race([page.evaluate((i) => { window.__TG__ = performance.now(); return window.__MARS__.goto(i, { instant: true }).then((r) => { window.__TA__ = performance.now(); return r; }); }, id), new Promise((r) => setTimeout(() => r('timeout'), 300000))]);
        row.idle = await page.evaluate((ms) => window.__MARS__.waitIdle(ms, 20), idle);
        await page.waitForTimeout(800);
        Object.assign(row, await page.evaluate(async (i) => {
          const M = window.__MARS__, app = M.app, c = app.controls;
          const bm = M.bookmarks().find((b) => b.id === i) || {};
          const pose = M.pose(), info = c.cameraInfo();
          let expected = bm.pose ? bm.pose.alt : null, expSrc = 'bookmark';
          if (bm.megaView) { try { const v = app.systems.mega.views()[bm.megaView]; if (v) { expected = v.alt; expSrc = 'megaView'; } } catch { /* */ } }
          if (bm.buildingId && info.hold) { expected = info.hold.requested.alt; expSrc = 'buildingView'; }
          const busy = Object.entries(app.systems).filter(([, s]) => s && s.isIdle && !s.isIdle()).map(([k]) => k);
          const out = { pose: { lat: +pose.lat.toFixed(7), lon: +pose.lon.toFixed(7), alt: +pose.alt.toFixed(3), heading: +pose.heading.toFixed(2), pitch: +pose.pitch.toFixed(2), lens: pose.lens },
            mode: info.mode, hold: info.hold, expected, expSrc, bookmarkAlt: bm.pose ? bm.pose.alt : null, walk: info.walk, busy, workersPending: app.workers.pending };
          if (info.mode === 'walk') {
            const wf = c.walkFloorBelow(app.rig.position, { maxDown: 4 });
            out.floor = { h: +wf.h.toFixed(3), kind: wf.kind, eyeAbove: +(pose.alt - wf.h).toFixed(3) };
            if (bm.buildingId) {
              const fi = await c.getFocusInfo(bm.buildingId);
              const g0 = fi && fi.spec && fi.spec.ground ? fi.spec.ground.entrance : null;
              const floors = fi && fi.anchors && fi.anchors.floors ? fi.anchors.floors : null;
              out.building = { entrance: g0, feetLocal: g0 != null ? +(pose.alt - 1.65 - g0).toFixed(3) : null, floors: floors ? floors.map((f) => [f.level, +f.y.toFixed(2)]) : null };
            }
          }
          // altitude samples after the bookmark resolved (goto promise): transient lifts above the request
          out.trace = window.__TRACE__.filter((t) => t[0] >= (window.__TA__ || window.__TG__ || 0) + 300);
          out.gotoMs = window.__TA__ && window.__TG__ ? Math.round(window.__TA__ - window.__TG__) : null;
          out.view = window.__BVR__ ?? null;
          return out;
        }, id));
        const tr = row.trace || [];
        row.traceMaxAlt = tr.length ? Math.max(...tr.map((t) => t[1])) : null;
        row.traceN = tr.length; delete row.trace;
        row.err = row.expected != null ? +(row.pose.alt - row.expected).toFixed(3) : null;
        await shot(page, `fix1-${id}.png`);
      } catch (e) { row.error = String(e.message || e).split('\n')[0]; }
      row.ms = Date.now() - t0;
      rows.push(row);
      report.results.bookmarks = rows;
      saveReport();
      console.error(`${id}: alt ${row.pose && row.pose.alt} expected ${row.expected} (${row.expSrc}) err ${row.err} mode ${row.mode} idle ${row.idle} traceMax ${row.traceMaxAlt} ${row.ms} ms`);
      await ctx.close();
    }
    for (const r of rows) check(`bookmark ${r.id}: final altitude = requested (${r.expSrc}) within 0.5 m`, r.err != null && Math.abs(r.err) <= 0.5, { alt: r.pose && r.pose.alt, expected: r.expected, err: r.err, mode: r.mode, hold: r.hold });
    const c7 = rows.find((r) => r.id === 'S07c');
    if (c7) check('bookmark S07c: walking on the 2nd floor (feet on storey level 1)', c7.mode === 'walk' && c7.building && c7.building.floors && c7.building.floors.length > 1 && Math.abs(c7.building.feetLocal - c7.building.floors[1][1]) < 0.3, { mode: c7.mode, floor: c7.floor, building: c7.building });
  }

  if (suite === 'sequence') {
    // fix round 2 CT1 (QS-03): building-view bookmarks visited one after another in ONE page (the
    // shot-07 sequence, incl. switching buildings). Every goto must resolve true and stand at the
    // controls' resolved request (not the bookmark's shared fallback pose); interruptions are logged.
    const ids = opt('only', 'S07,S07b,S07s,S07c,S07d,S07O,S07Ob,S07Oc,S07Od,S07Oe').split(',');
    const shotIds = new Set(opt('shots', 'S07b,S07c,S07d,S07Od,S07Oe').split(','));
    const q = opt('query', '&workers=2');
    const idle = +opt('idle', 60000);
    // --o07 <id>: run the S07O* bookmarks against another building (same views, one shared fallback pose
    // beside it) — for when the plan no longer has the bookmarked building
    const o07 = opt('o07', null);
    const { ctx, page } = await open(`/?clean=1${q}`);
    let sub = null;
    if (o07) sub = await page.evaluate(async (bid) => { const info = await window.__MARS__.app.controls.getFocusInfo(bid); return info && info.spec ? { id: bid, lat: info.spec.lat + 0.00012, lon: info.spec.lon + 0.00012, alt: info.spec.ground.entrance + 2 } : null; }, o07);
    report.results.sub = sub;
    const logs = [];
    page.on('console', (m) => { const s = m.text(); if (/\[bookmark|\[controls/.test(s)) logs.push(`${m.type()}: ${s}`); });
    const rows = [];
    for (const id of ids) {
      const t0 = Date.now();
      const row = { id };
      try {
        row.goto = await Promise.race([page.evaluate(([i, sb]) => {
          const M = window.__MARS__;
          let bm = i;
          if (sb && /^S07O/.test(i)) { const b = M.bookmarks().find((x) => x.id === i); bm = { ...b, buildingId: sb.id, pose: { ...b.pose, lat: sb.lat, lon: sb.lon, alt: sb.alt } }; window.__SUBBM__ = bm; } else window.__SUBBM__ = null;
          return M.goto(bm, { instant: true });
        }, [id, sub]), new Promise((r) => setTimeout(() => r('timeout'), 240000))]);
        row.gotoMs = Date.now() - t0;
        row.idle = await page.evaluate((ms) => window.__MARS__.waitIdle(ms, 20), idle);
        Object.assign(row, await page.evaluate((i) => {
          const M = window.__MARS__, app = M.app, c = app.controls;
          const bm = window.__SUBBM__ || M.bookmarks().find((b) => b.id === i) || {};
          const pose = M.pose(), info = c.cameraInfo();
          let pick = null;
          try { const h = c.pick(); pick = h ? { type: h.type, id: h.id ?? null, d: +(h.distance || 0).toFixed(1) } : null; } catch { /* */ }
          const fb = bm.pose || {};
          const dFallback = Math.hypot((pose.lat - fb.lat) * 59158, (pose.lon - fb.lon) * 59158 * Math.cos(pose.lat * Math.PI / 180), pose.alt - fb.alt);
          return { pose: { lat: +pose.lat.toFixed(7), lon: +pose.lon.toFixed(7), alt: +pose.alt.toFixed(3), heading: +pose.heading.toFixed(2), pitch: +pose.pitch.toFixed(2), lens: pose.lens },
            mode: info.mode, hold: info.hold && { src: info.hold.src, walk: info.hold.walk, lifted: info.hold.lifted, alt: +info.hold.requested.alt.toFixed(3) },
            view: bm.view, building: bm.buildingId, dFallback: +dFallback.toFixed(2), pick, views: c.buildingViews(bm.buildingId) };
        }, id));
        row.err = row.hold ? +(row.pose.alt - row.hold.alt).toFixed(3) : null;
        if (shotIds.has(id)) await shot(page, `fix2-seq-${id}.png`);
      } catch (e) { row.error = String(e.message || e).split('\n')[0]; }
      row.ms = Date.now() - t0;
      rows.push(row);
      report.results.sequence = rows; report.results.logs = logs;
      saveReport();
      console.error(`${id}: goto ${row.goto} (${row.gotoMs} ms) mode ${row.mode} alt ${row.pose && row.pose.alt} hold ${row.hold && row.hold.src}/${row.hold && row.hold.alt} dFallback ${row.dFallback} pick ${JSON.stringify(row.pick)} idle ${row.idle}`);
    }
    for (const r of rows) check(`sequence ${r.id}: goto true, standing at the controls' resolved viewpoint (held ${r.hold && r.hold.src})`, r.goto === true && r.hold && r.hold.src === 'bookmark' && Math.abs(r.err) < 0.05, { goto: r.goto, err: r.err, mode: r.mode, dFallback: r.dFallback, pick: r.pick });
    // the S07O* views share ONE fallback pose: each must land at its own viewpoint
    const so = rows.filter((r) => /^S07O/.test(r.id) && r.pose);
    if (so.length > 1) {
      const key = (r) => `${r.pose.lat.toFixed(6)},${r.pose.lon.toFixed(6)},${r.pose.alt.toFixed(2)},${r.pose.heading.toFixed(1)}`;
      check('sequence: the S07O* views (one shared fallback pose) land at distinct viewpoints', new Set(so.map(key)).size === so.length && so.every((r) => r.dFallback > 0.5), so.map((r) => [r.id, key(r), r.dFallback]));
    }
    check('sequence: no bookmark interrupted / fallback messages', !logs.some((s) => /interrupted|took over|superseded|stored pose/.test(s)), logs);
    await ctx.close();
  }

  if (suite === 'clearview') {
    // fix round 2 QP-03: eye-level street / back viewpoints must not stand inside (or face the wall of)
    // the building across the street / behind: after buildingView the centre pick is the building itself.
    const jobs = opt('jobs', 'ZR1-0.3.1c7.19m-n1.4-9:street;OX3-1.3.7d.10a-n8.3-1:street,back;ZR2-1.3.p4.1ho-n4.3-11:street,back').split(';');
    const { ctx, page } = await open(`/?clean=1${opt('query', '&workers=2')}`);
    const rows = [];
    for (const job of jobs) {
      const [id, vs] = job.split(':');
      try {
        // stand above the building first so its tile and the neighbours stream in
        const ok = await page.evaluate(async (bid) => {
          const c = window.__MARS__.app.controls, info = await c.getFocusInfo(bid);
          if (!info || !info.spec) return false;
          await window.__MARS__.goto({ lat: info.spec.lat, lon: info.spec.lon, alt: info.spec.ground.entrance + 260, heading: 0, pitch: -60, lens: 35 });
          return true;
        }, id);
        if (!ok) { rows.push({ id, error: 'no spec' }); continue; }
        await page.evaluate(() => window.__MARS__.waitIdle(40000, 10));
        for (const v of vs.split(',')) {
          const row = { id, view: v };
          row.r = await page.evaluate(async ([bid, view]) => {
            const r = await window.__MARS__.app.controls.buildingView(bid, view, { instant: true });
            return r && { arrived: r.arrived, view: r.view, mode: r.mode, adjusted: r.adjusted || null, interrupted: r.interrupted || null };
          }, [id, v]);
          await page.evaluate(() => window.__MARS__.waitIdle(25000, 10));
          row.pick = await page.evaluate(() => { const h = window.__MARS__.app.controls.pick(); return h ? { type: h.type, id: h.id ?? null, d: +(h.distance || 0).toFixed(1) } : null; });
          await shot(page, `fix2-clear-${id.split('-')[0]}-${v}.png`);
          rows.push(row);
          report.results.clearview = rows; saveReport();
          console.error(`clear ${id}/${v}: ${JSON.stringify(row.r)} pick ${JSON.stringify(row.pick)}`);
        }
      } catch (e) { rows.push({ id, error: String(e.message || e).split('\n')[0] }); }
    }
    for (const r of rows) if (r.view) check(`clearview ${r.id}/${r.view}: arrived, centre pick is the building (not a neighbour / wall at < 3 m)`, r.r && r.r.arrived && r.pick && ((r.pick.type === 'building' && String(r.pick.id) === r.id) || (r.pick.d > 3 && r.pick.type !== 'building')), r);
    await ctx.close();
  }

  if (suite === 'walkground') {
    // fix round 2 CT2 (Z-02): walking right after a cold landing while the terrain still refines — the
    // feet stay on the analytic ground (terrain.heightAtLatLon) + colliders, never on a coarse tile above it.
    const poses = (opt('poses', '23.592,111.9344,1526.382,163,-20,28;34.8703,-105.2138,958.751,163,-15,28')).split(';');
    const wait = +opt('wait', 30000);
    const rows = [];
    for (const ps of poses) {
      const { ctx, page } = await open(`/?pose=${ps}&mode=walk&time=2.138&clean=1${opt('query', '&workers=2')}`);
      const row = { pose: ps };
      try {
        await page.waitForTimeout(wait);
        const sample = () => page.evaluate(() => {
          const app = window.__MARS__.app, c = app.controls, p = app.rig.getPose(), w = c.modes.walk;
          const ha = app.systems.terrain.heightAtLatLon(p.lat, p.lon);
          let tile = null; try { tile = app.systems.terrain.groundHeightAt(p.lat, p.lon); } catch { /* */ }
          const ch = app.systems.terrain.chainInfo ? app.systems.terrain.chainInfo() : null;
          return { t: Math.round(performance.now()), eyeOverAnalytic: +(p.alt - ha).toFixed(3), tileOverAnalytic: tile != null ? +(tile - ha).toFixed(2) : null, kind: w.info.groundKind, grounded: w.info.grounded, mode: c.modeName, nadir: ch && ch.nadirLevel, datum: ch && +(+ch.datum || 0).toFixed(2) };
        });
        row.start = await sample();
        await shot(page, `fix2-walk-start-${rows.length}.png`);
        const trace = [];
        await page.evaluate(() => { document.querySelector('canvas')?.focus?.(); });
        const hold = async (key, ms) => { await page.keyboard.down(key); const t1 = Date.now() + ms; while (Date.now() < t1) { trace.push(await sample()); await page.waitForTimeout(250); } await page.keyboard.up(key); };
        await hold('KeyW', 8000); await hold('KeyD', 4000);
        for (let i = 0; i < 8; i++) { trace.push(await sample()); await page.waitForTimeout(250); }
        row.trace = trace;
        const dev = trace.filter((s) => s.mode === 'walk' && s.kind === 'terrain').map((s) => s.eyeOverAnalytic - 1.65);
        row.maxDev = dev.length ? +Math.max(...dev.map(Math.abs)).toFixed(3) : null;
        row.maxTileOver = trace.length ? Math.max(...trace.map((s) => s.tileOverAnalytic ?? -1e9)) : null;
        row.end = trace[trace.length - 1];
        await shot(page, `fix2-walk-end-${rows.length}.png`);
      } catch (e) { row.error = String(e.message || e).split('\n')[0]; }
      rows.push(row);
      report.results.walkground = rows; saveReport();
      console.error(`walk ${ps}: start ${JSON.stringify(row.start)} maxDev ${row.maxDev} maxTileOver ${row.maxTileOver} end ${JSON.stringify(row.end)}`);
      await ctx.close();
    }
    for (const r of rows) check(`walkground ${r.pose}: feet on the analytic ground while walking (|dev| < 0.05 m on terrain)`, r.maxDev != null && r.maxDev < 0.05, { maxDev: r.maxDev, maxTileOver: r.maxTileOver, start: r.start, end: r.end });
  }

  if (suite === 'main' || suite === 'city') {
    // Drives the real app (index.html: real quadtree terrain, atmosphere, UI) with synthetic input.
    // 'city': real city buildings (render/city): pick → focus → presets → enter → walk in → upper
    // floor → stairs → back, with real three-mesh-bvh colliders.
    // (city: start right above the district so the city tiles stream first; the camera is the
    //  lookAt(lat, lon, range 700 m, heading 25°, tilt 58°) pose of the default district)
    const { ctx, page } = await open(suite === 'city' ? `/?pose=${opt('pose', '22.2909,118.5954,889,25,-32')}&time=${opt('time', '9.6')}&clean=1` : '/?time=9');
    const prelude = `
      const app = window.__MARS__.app, c = app.controls, el = app.renderer.domElement;
      const H = window.__CH__ || (window.__CH__ = (() => {
        const frames = async (n = 1) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
        const until = async (fn, ms = 10000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await frames(1); } return false; };
        const rc = () => el.getBoundingClientRect();
        const wheel = (x, y, d, o = {}) => el.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: d, ctrlKey: !!o.ctrl, bubbles: true, cancelable: true }));
        const ptr = (type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: o.button ?? 0, buttons: type === 'pointerup' ? 0 : (o.button === 2 ? 2 : 1), pointerId: o.id ?? 1, pointerType: o.type ?? 'mouse', isPrimary: true, ctrlKey: !!o.ctrl, bubbles: true, cancelable: true }));
        const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
        const tap = async (code) => { key(code, true); await frames(1); key(code, false); };
        const proj = (p) => { const r = rc(); const n = app.rig.projectNdc(p, r.width / r.height); return { x: r.left + (n.x + 1) / 2 * r.width, y: r.top + (1 - n.y) / 2 * r.height, depth: n.z }; };
        const surf = (x, y) => { const r = c.rayAt(x, y); return c.ground.surfacePoint(r.o.clone(), r.d.clone()); };
        const qang = (a, b) => { const w = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z; const x = a.w * b.x - a.x * b.w - a.y * b.z + a.z * b.y; const y = a.w * b.y + a.x * b.z - a.y * b.w - a.z * b.x; const z = a.w * b.z - a.x * b.y + a.y * b.x - a.z * b.w; return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)); };
        const idle = async (ms = 30000) => { await until(() => c.isIdle(), ms); return window.__MARS__.waitIdle(ms, 6); };
        const r3 = (x) => Math.round(x * 1000) / 1000;
        const settle = async () => { await until(() => c.isIdle(), 15000); await frames(3); };
        // zoom at integer client coordinates (MouseEvent clientX is truncated to an integer)
        // The zoom anchor is the visible surface under the cursor; the real terrain refines while the
        // camera descends, so the controls re-pick it on the refined surface (time gap, blocked sweep).
        // Measured: the anchor in use each frame (pxErrMax), plus the drift of the first picked point.
        const zoomCheck = async (fx, fy, notches, delta = -100) => {
          const r = rc(); const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
          const A = surf(x, y).point.clone(); const o = c.modes.orbit; let err = 0, errA = 0, picks = 0, last = null;
          for (let i = 0; i < notches; i++) {
            wheel(x, y, delta); await frames(2);
            const Z = o.zoomAnchor; if (!last || last.distanceTo(Z) > 1e-6) { picks++; last = Z.clone(); }
            const p = proj(Z); err = Math.max(err, Math.hypot(p.x - x, p.y - y));
            const q = proj(A); errA = Math.max(errA, Math.hypot(q.x - x, q.y - y));
          }
          await settle(); const p = proj(o.zoomAnchor);
          return { pxErrMax: r3(Math.max(err, Math.hypot(p.x - x, p.y - y))), pxErrEnd: r3(Math.hypot(p.x - x, p.y - y)), anchorPicks: picks, firstPointDriftPx: r3(errA), anchorShift_m: r3(A.distanceTo(o.zoomAnchor)), hAG: r3(c.heightAboveGround(true)), pitch: r3(app.rig.getPose().pitch) };
        };
        const dragCheck = async (fx0, fy0, fx1, fy1, steps = 24) => {
          const r = rc(); const x0 = Math.round(r.left + r.width * fx0), y0 = Math.round(r.top + r.height * fy0), x1 = Math.round(r.left + r.width * fx1), y1 = Math.round(r.top + r.height * fy1);
          const G = surf(x0, y0).point.clone(); ptr('pointerdown', x0, y0); let err = 0;
          for (let i = 1; i <= steps; i++) { const x = Math.round(x0 + (x1 - x0) * i / steps), y = Math.round(y0 + (y1 - y0) * i / steps); ptr('pointermove', x, y); const f0 = app.frameNo; await until(() => app.frameNo >= f0 + 2, 1000); const p = proj(G); err = Math.max(err, Math.hypot(p.x - x, p.y - y)); }
          await frames(8); ptr('pointerup', x1, y1); await frames(2);
          const pose = app.rig.getPose(); return { pxErrMax: r3(err), roll: r3(pose.roll), valid: app.rig.isValid() };
        };
        const flyExact = async (target, opts = {}) => {
          const want = c.resolveTarget(target); const res = await c.flyTo(target, opts); const P = app.rig.position;
          return { arrived: res.arrived, posErr: Math.hypot(P.x - want.position.x, P.y - want.position.y, P.z - want.position.z), angErr: qang(app.rig.quaternion, want.quaternion) };
        };
        return { frames, until, rc, wheel, ptr, key, tap, proj, surf, qang, idle, r3, settle, zoomCheck, dragCheck, flyExact };
      })());`;
    const run = (expr) => page.evaluate(`(async () => { ${prelude}\n${expr} })()`);
    const R = report.results;
    if (suite === 'city') {
      const lat = +opt('lat', 22.30), lon = +opt('lon', 118.60);
      const C = R.city = {};
      const lp = `const { buildingAxes, latLonHToEcef } = await import('/src/core/geo.js');
        const { entrancePose } = await import('/src/controls/modes/focus.js');
        const fm = c.modes.focus, w = c.modes.walk, info = fm.info, spec = info && info.spec;
        const frameOf = () => { const A = buildingAxes(spec.lat, spec.lon, spec.heading || 0); const o = latLonHToEcef(spec.lat, spec.lon, (spec.ground && spec.ground.entrance) || 0);
          return (p) => { const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z; return { x: A.x[0] * dx + A.x[1] * dy + A.x[2] * dz, y: A.y[0] * dx + A.y[1] * dy + A.y[2] * dz, z: A.z[0] * dx + A.z[1] * dy + A.z[2] * dz }; }; };
        const v3 = (l) => [H.r3(l.x), H.r3(l.y), H.r3(l.z)];`;
      // 1. a city district, oblique; candidates = multi-storey buildings with an entrance that are
      //    pickable at their projected centre
      C.site = await run(`const lat = ${lat}, lon = ${lon}; const t0 = performance.now();
        // TEST HARNESS ONLY: on a cold start the terrain refinement keeps every pool worker busy and the
        // city jobs (priority ≥ 90) starve for many minutes (reported to city / terrain-render). Pin the
        // city's jobs ahead of the terrain so the controls can be exercised against real buildings.
        if (${opt('boostCity', '1') === '1'}) {
          const W = app.workers;
          const boost = (job) => { if (job && /^(cityTile|cityStreets|building)$/.test(job.type)) { try { Object.defineProperty(job, 'priority', { get: () => -20, set: () => {}, configurable: true }); } catch { /* */ } } };
          for (const j of W.queue) boost(j);
          const sub = W.submit.bind(W);
          W.submit = (type, payload, o) => { const job = sub(type, payload, o); boost(job); return job; };
        }
        const { normalizeFocusInfo } = await import('/src/controls/index.js');
        const city = app.systems.city; let list = [], cands = [];
        const find = () => {
          list = city.findBuildings ? city.findBuildings({ near: { lat, lon }, radius: 500, limit: 500 }) : [];
          const r = H.rc(); cands = [];
          for (const { spec } of list) {
            if (!(spec.floors >= 3) || !spec.entrances || !spec.entrances.length) continue;
            const info = normalizeFocusInfo(null, spec); if (!info || info.radius > 40) continue;
            const s = H.proj(info.center); const x = Math.round(s.x), y = Math.round(s.y);
            if (s.depth <= 0 || x < r.left + 120 || x > r.right - 120 || y < r.top + 120 || y > r.bottom - 120) continue;
            const hit = c.pick(x, y);
            if (hit && hit.type === 'building' && String(hit.id) === String(spec.id)) cands.push({ id: spec.id, x, y, use: spec.use, floors: spec.floors, radius: H.r3(info.radius) });
            if (cands.length >= 8) break;
          }
          return cands.length > 0;
        };
        // the city tiles queue behind the terrain jobs on a cold start: wait for pickable buildings
        while (performance.now() - t0 < ${+opt('cityWait', 600000)} && !find()) await new Promise((r) => setTimeout(r, 2000));
        await H.idle(60000); find();
        window.__CITY__ = { cands };
        return { waitS: H.r3((performance.now() - t0) / 1000), buildings: list.length, cands: cands.slice(0, 4), cityStats: city.stats ? { tiles: city.stats.tilesDisplayed, buildings: city.stats.buildings } : null }`);
      await shot(page, 'c00_district.png');
      if (C.site.cands && C.site.cands.length) {
        // 2. click selects the building (unified shape), hover reports it
        C.pick = await run(`const cd = window.__CITY__.cands[0]; const sel = []; const off = app.events.on('select', (s) => sel.push(s));
          H.ptr('pointerdown', cd.x, cd.y); H.ptr('pointerup', cd.x, cd.y); await H.frames(24); off();
          const s = app.state.selection;
          el.dispatchEvent(new PointerEvent('pointermove', { clientX: cd.x + 1, clientY: cd.y, pointerType: 'mouse', buttons: 0, bubbles: true })); await H.frames(40);
          const h = app.state.hover;
          return { want: cd.id, sel: s && { type: s.type, id: s.id, hasSpec: !!s.spec, distance: H.r3(s.distance) }, events: sel.length, hover: h && { type: h.type, id: h.id } }`);
        // 3. Enter on a selected building → focus mode
        C.focus = await run(`H.key('Enter', true); H.key('Enter', false);
          await H.until(() => c.modeName === 'focus' && !c.transition && !c._focusReq, 30000); await H.settle(); await H.idle(60000);
          const fm = c.modes.focus;
          return { mode: c.modeName, id: fm.id, hAG: H.r3(c.heightAboveGround(true)), dist: H.r3(fm.dist), radius: H.r3(fm.info.radius), frame: !!fm.info.frame, lod: fm.info.raw && fm.info.raw.lod }`);
        await shot(page, 'c01_focus.png');
        for (const [k, name] of [['Digit2', 'back'], ['Digit5', 'roof'], ['Digit1', 'front']]) {
          C['view_' + name] = await run(`await H.tap('${k}'); await H.until(() => !c.modes.focus.isMoving(), 8000); await H.idle(40000);
            const fm = c.modes.focus; const hd = fm.info.heading || 0; const wrap = (a) => ((a % 360) + 540) % 360 - 180;
            return { azFromFront: H.r3(wrap(fm.az * 57.2957795 - hd)), el: H.r3(fm.el * 57.2957795), hAG: H.r3(c.heightAboveGround(true)) }`);
          await shot(page, `c02_focus_${name}.png`);
        }
        // 4. Enter in focus mode → walk at the main entrance (colliders of the 'full' LOD arrive a bit later)
        C.enter = await run(`${lp}
          H.key('Enter', true); H.key('Enter', false);
          await H.until(() => c.modeName === 'walk' && !c.transition && !c._focusReq, 30000);
          await H.until(() => w.colliders.some((x) => String(x.id) === String(fm.id)), 40000); await H.frames(10);
          const ent = entrancePose(fm.info, 'main'); const P = app.rig.position; const f = app.rig.forward();
          return { mode: c.modeName, colliders: w.colliders.length, own: w.colliders.some((x) => String(x.id) === String(fm.id)), ids: w.colliders.map((x) => x.id).slice(0, 6),
            distToDoor: H.r3(Math.hypot(P.x - ent.pos.x, P.y - ent.pos.y, P.z - ent.pos.z)), facingDoor: H.r3(-(f.x * ent.out.x + f.y * ent.out.y + f.z * ent.out.z)),
            feetAboveEntrance: H.r3(w.info.feetH - ((spec.ground && spec.ground.entrance) || 0)), kind: w.info.groundKind }`);
        C.rest = await run(`await H.frames(10); const v0 = app.rig.version; await H.frames(40); const v1 = app.rig.version;
          return { walkDelta: v1 - v0, accumN: app.pipeline && app.pipeline.accum ? app.pipeline.accum.n : null }`);
        await shot(page, 'c03_at_door.png');
        // 5. walk straight in (W) through the door
        C.walkIn = await run(`${lp}
          const loc = frameOf(); const ent = entrancePose(info, 'main'); const inw = { x: -ent.out.x, y: -ent.out.y, z: -ent.out.z };
          const depth = (p) => (p.x - ent.pos.x) * inw.x + (p.y - ent.pos.y) * inw.y + (p.z - ent.pos.z) * inw.z;
          const d0 = depth(w.feet); let dMax = d0, errMax = 0, n = 0, fps = 0; const track = [];
          H.key('KeyW', true); const t0 = performance.now(); const f0 = app.frameNo; c.perf.max = 0;
          // walk until 2.5 m past the entrance anchor (or blocked): simulated time, not wall-clock — the app
          // runs at 2–5 fps under heavy machine load (dt is clamped to 0.1 s per frame)
          let still = 0, last = d0;
          while (performance.now() - t0 < 40000 && dMax < 2.5 && still < 60) { await H.frames(1); const dd = depth(w.feet); still = Math.abs(dd - last) < 1e-3 ? still + 1 : 0; last = dd; dMax = Math.max(dMax, dd); if (w.grounded) { errMax = Math.max(errMax, Math.abs(w.info.feetH - w.info.groundH)); n++; } if ((app.frameNo - f0) % 40 === 0) track.push(v3(loc(w.feet))); }
          fps = (app.frameNo - f0) / ((performance.now() - t0) / 1000);
          H.key('KeyW', false); await H.frames(20);
          const l = loc(w.feet); const fp = spec.footprint || {};
          return { startDepth: H.r3(d0), maxDepth: H.r3(dMax), endLocal: v3(l), insideFootprint: Math.abs(l.x) < (fp.w || 0) / 2 && Math.abs(l.z) < (fp.d || 0) / 2,
            groundErrMax: H.r3(errMax), samples: n, kind: w.info.groundKind, fps: H.r3(fps), controlsMsMax: H.r3(c.perf.max), track,
            own: w.hasCollider(fm.id), colliders: w.colliders.length, ids: w.colliders.map((x) => x.id).slice(0, 8), wallGuard: w.info.wallGuard || 0, entLocal: v3(loc(ent.pos)) }`);
        await shot(page, 'c04_walked_in.png');
        // debug layer 'wireframe': walk colliders drawn around the walker (none in clean mode)
        C.debugWire = await run(`app.state.set('clean', false); app.state.set('debugLayer', 'wireframe'); await H.frames(30);
          const g = app.scene.getObjectByName('controls:colliders'); return { group: !!g, visible: !!(g && g.visible), meshes: g ? g.children.length : 0 }`);
        await shot(page, 'c04b_debug_colliders.png');
        C.debugWireClean = await run(`app.state.set('clean', true); await H.frames(10); const g = app.scene.getObjectByName('controls:colliders');
          const vis = !!(g && g.visible); app.state.set('debugLayer', 'none'); await H.frames(5); return { visibleInClean: vis }`);
        // 6. upper-floor viewpoint (§5 07 二层窗边): walk mode on that floor
        C.living = await run(`${lp}
          // §5 07 二层起居室: a residential building has a 'living' anchor on the upper floor; when the
          // focused building is another type, visit the nearest residential candidate instead
          let id = fm.id, sp = spec;
          const cams = fm.info && (fm.info.cameras || (fm.info.anchors && fm.info.anchors.cameras));
          if (!(cams && cams.living)) { const rc = window.__CITY__.cands.find((x) => /residential/.test(x.use) && x.floors >= 2); if (rc) { id = rc.id; sp = null; } }
          const r = await c.buildingView(id, 'living', { duration: 1.5, waitMs: 30000 }); await H.frames(30);
          const info2 = c.modes.focus.info && String(c.modes.focus.id) === String(id) ? c.modes.focus.info : await c.getFocusInfo(id);
          const s2 = info2.spec; const A = buildingAxes(s2.lat, s2.lon, s2.heading || 0); const o = latLonHToEcef(s2.lat, s2.lon, (s2.ground && s2.ground.entrance) || 0);
          const loc = (p) => { const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z; return { x: A.x[0] * dx + A.x[1] * dy + A.x[2] * dz, y: A.y[0] * dx + A.y[1] * dy + A.y[2] * dz, z: A.z[0] * dx + A.z[1] * dy + A.z[2] * dz }; };
          const l = loc(w.feet);
          H.key('KeyA', true); await H.frames(60); H.key('KeyA', false); await H.frames(20);
          return { id, use: s2.use, res: r && { arrived: r.arrived, view: r.view, mode: r.mode }, mode: c.modeName, feetLocalY: H.r3(l.y), afterStrafeY: H.r3(loc(w.feet).y), grounded: w.grounded, kind: w.info.groundKind, feetErr: H.r3(Math.abs(w.info.feetH - w.info.groundH)) }`);
        await shot(page, 'c05_living.png');
        // 7. stairs: from the stair viewpoint walk up the flight
        C.stair = await run(`${lp}
          const r = await c.buildingView(fm.id, 'stair', { duration: 1.5 }); await H.frames(30);
          const loc = frameOf(); const y0 = loc(w.feet).y; let yMax = y0; const ys = [];
          // walk ahead; when blocked without climbing (anchor looking along the stair well) try turning
          const tries = [];
          for (const turn of [0, 35, -35, 70, -70]) {
            if (yMax - y0 > 1.0 || c.modeName !== 'walk') break;
            if (turn) w.turn(turn * Math.PI / 180, 0);
            H.key('KeyW', true); const t0 = performance.now(); let k = 0;
            while (performance.now() - t0 < (turn ? 3000 : 4000)) { await H.frames(1); const y = loc(w.feet).y; yMax = Math.max(yMax, y); if (k++ % 30 === 0) ys.push(H.r3(y)); }
            H.key('KeyW', false); await H.frames(10); tries.push({ turn, yMax: H.r3(yMax - y0), end: v3(loc(w.feet)) });
            if (yMax - y0 <= 1.0 && turn) w.turn(-turn * Math.PI / 180, 0);
          }
          return { res: r && { arrived: r.arrived, view: r.view, mode: r.mode }, mode: c.modeName, y0: H.r3(y0), yMax: H.r3(yMax), rise: H.r3(yMax - y0), ys, tries, kind: w.info.groundKind }`);
        await shot(page, 'c06_stair.png');
        // 8. back
        C.back = await run(`const n = c.backStack.length; const r = await c.back(); await H.frames(5); return { depthBefore: n, arrived: r.arrived, mode: c.modeName, depthAfter: c.backStack.length }`);
        await shot(page, 'c07_back.png');
        // 9. back to the orbit view over the same lat/lon, then revisit the same building by its ID (§6 每栋建筑可定位)
        C.revisit = await run(`const id = window.__CITY__.cands[0].id; const g0 = app.rig.geo;
          const h = await c.home({ duration: 2.5 }); const g1 = app.rig.geo; const alt1 = g1.h;
          const r = await c.focusBuilding(id, { duration: 4 }); await H.settle();
          const fm = c.modes.focus;
          return { home: h.arrived, homeAltKm: H.r3(alt1 / 1000), homeLatErr: H.r3(Math.abs(g1.lat - g0.lat)), focus: r && r.arrived, mode: c.modeName, sameId: String(fm.id) === String(id), hAG: H.r3(c.heightAboveGround(true)) }`);
        await run('await H.idle(60000)');
        await shot(page, 'c08_revisit.png');
        C.perf = await run('return { controlsMsEMA: H.r3(c.perf.ms), controlsMsMax: H.r3(c.perf.max), fps: H.r3(app.fps), ground: c.ground.stats }');
        check('city: click selects the real building ({type, id, spec, distance}) and hover reports it', C.pick.sel && C.pick.sel.type === 'building' && String(C.pick.sel.id) === String(C.pick.want) && C.pick.sel.hasSpec && C.pick.sel.distance > 0 && C.pick.hover && String(C.pick.hover.id) === String(C.pick.want), C.pick);
        check('city: Enter focuses the selected building above the ground; presets back / roof / front', C.focus.mode === 'focus' && C.focus.hAG >= 1.69 && Math.abs(Math.abs(C.view_back.azFromFront) - 180) < 1 && Math.abs(C.view_roof.el - 72) < 1 && Math.abs(C.view_front.azFromFront) < 1, { focus: C.focus, back: C.view_back, roof: C.view_roof, front: C.view_front });
        check('city: Enter in focus walks to the main entrance facing the door, building colliders loaded', C.enter.mode === 'walk' && C.enter.own && C.enter.distToDoor < 5.5 && C.enter.facingDoor > 0.9, C.enter);
        check('city: walking in through the door ends inside the footprint, feet on the floor', C.walkIn.maxDepth > 1.0 && C.walkIn.insideFootprint && C.walkIn.groundErrMax < 0.01, C.walkIn);
        check('city: a resting walker leaves the camera untouched (temporal accumulation converges)', C.rest && C.rest.walkDelta === 0, C.rest);
        check('city: debugLayer wireframe shows the walk colliders, hidden in clean mode', C.debugWire && C.debugWire.visible && C.debugWire.meshes > 0 && C.debugWireClean && !C.debugWireClean.visibleInClean, { on: C.debugWire, clean: C.debugWireClean });
        check('city: upper-floor viewpoint stands on that floor (walk mode)', C.living.mode === 'walk' && C.living.feetLocalY > 2.5 && Math.abs(C.living.afterStrafeY - C.living.feetLocalY) < 0.05 && C.living.feetErr < 0.01, C.living);
        check('city: stairs climbable from the stair viewpoint', C.stair.mode === 'walk' && C.stair.rise > 1.0, C.stair);
        check('city: home() returns to the orbit view over the same lat/lon; the building is revisited by its ID', C.revisit.home && Math.abs(C.revisit.homeAltKm - 9500) < 1 && C.revisit.homeLatErr < 0.01 && C.revisit.focus && C.revisit.mode === 'focus' && C.revisit.sameId && C.revisit.hAG >= 1.69, C.revisit);
      } else check('city: candidate buildings found', false, C.site);
    }
    if (suite === 'main') {
    await run('await H.idle(30000)');
    await shot(page, 'm01_start.png');

    R.zoomOrbit = await run('return await H.zoomCheck(0.58, 0.47, 25)');
    await run('await H.idle(30000)');
    await shot(page, 'm02_after_zoom.png');
    R.zoomRegion = await run(`await c.flyTo({ lat: 22.25, lon: 118.55, alt: 3.0e5, heading: 0, pitch: -90 }, { duration: 1.2 }); await H.idle(40000);
      const a = await H.zoomCheck(0.62, 0.40, 28); const b = await H.zoomCheck(0.30, 0.65, 10, 100); return { in: a, out: b }`);
    R.dragRegion = await run('await H.idle(30000); return await H.dragCheck(0.40, 0.55, 0.62, 0.38)');
    // rugged terrain: 西陆峡廊 canyon (ZR2)
    R.canyon = await run(`const { solTimeForLocal } = await import('/src/app/sun.js'); const t0 = app.state.solTime; app.state.setTime(solTimeForLocal(-105.0, 14.5));
      const g = c.groundHeightAt(35.0, -105.0);
      const fl = await H.flyExact({ lookAt: { lat: 35.0, lon: -105.0, h: g }, range: 2600, heading: 60, tilt: 62 }, { duration: 2.5 }); await H.idle(60000);
      const d = await H.dragCheck(0.45, 0.62, 0.60, 0.50); window.__CH_T0__ = t0; return { fly: fl, drag: d, hAG: H.r3(c.heightAboveGround(true)) }`);
    await run('await H.idle(40000)');
    await shot(page, 'm03_canyon.png');
    await run('app.state.setTime(window.__CH_T0__)');
    R.flyExact = await run(`return await H.flyExact({ lat: 22.3, lon: 118.6, alt: 2500, heading: 35, pitch: -28, lens: 35 })`);
    await run('await H.idle(40000)');
    await shot(page, 'm04_flyto_zr1.png');
    R.dive = await run(`const r = H.rc(); let minH = Infinity, nan = false;
      for (let i = 0; i < 80; i++) { H.wheel(Math.round(r.left + r.width / 2), Math.round(r.top + r.height * 0.6), -100); await H.frames(2); minH = Math.min(minH, c.heightAboveGround(true)); if (!app.rig.isValid()) nan = true; }
      await H.settle(); const p = app.rig.getPose(); return { minHAG: H.r3(minH), hAG: H.r3(c.heightAboveGround(true)), pitch: H.r3(p.pitch), roll: H.r3(p.roll), nan }`);
    await run('await H.idle(40000)');
    await shot(page, 'm05_dive_ground.png');
    // sky wheel at street level: dolly forward, stay low
    R.skyWheel = await run(`const P0 = { ...app.rig.position }; const h0 = c.heightAboveGround(true); const r = H.rc();
      for (let i = 0; i < 6; i++) { H.wheel(Math.round(r.left + r.width / 2), Math.round(r.top + r.height * 0.08), -100); await H.frames(2); }
      await H.settle(); const P = app.rig.position; const up = new (c.target.constructor)(P.x, P.y, P.z).normalize();
      const d = new (c.target.constructor)(P.x - P0.x, P.y - P0.y, P.z - P0.z); const vert = d.dot(up);
      return { moved: H.r3(d.length()), horizontal: H.r3(Math.sqrt(Math.max(0, d.lengthSq() - vert * vert))), h0: H.r3(h0), h1: H.r3(c.heightAboveGround(true)), kind: c.modes.orbit.zoomAnchorKind }`);
    R.walk = await run(`c.setMode('walk'); await H.until(() => !c.transition && c.modeName === 'walk', 8000);
      H.key('KeyW', true); H.key('ShiftLeft', true);
      const w = c.modes.walk; let err = 0, n = 0, below = 0; const t0 = performance.now();
      while (performance.now() - t0 < 4000) { await H.frames(1); if (w.grounded) { err = Math.max(err, Math.abs(w.info.feetH - w.info.groundH)); n++; } const g = app.rig.geo; const gt = app.systems.terrain.groundHeightAt(g.lat, g.lon); below = Math.min(below, g.h - gt - 1.6); }
      H.key('KeyW', false); H.key('ShiftLeft', false); await H.frames(20);
      const g = app.rig.geo; return { mode: c.modeName, groundErrMax: err, samples: n, eyeAboveDisplayedGround: H.r3(g.h - app.systems.terrain.groundHeightAt(g.lat, g.lon)), eyeAboveStandingSurface: H.r3(g.h - w.info.groundH), kind: w.info.groundKind, minMargin: H.r3(below), speed: H.r3(w.info.speed) }`);
    await shot(page, 'm06_walk.png');
    R.back = await run(`c.setMode('orbit'); await H.frames(5); await H.settle();
      const s0 = app.rig.snapshot(); const m0 = c.modeName;
      await c.flyTo({ lat: 30, lon: 140, alt: 8e5, heading: 20, pitch: -70 }, { duration: 1.5 });
      await H.zoomCheck(0.5, 0.5, 4);
      const r = await c.back(); const P = app.rig.position;
      const res = { arrived: r.arrived, mode: c.modeName, modeOk: c.modeName === m0, posErr: Math.hypot(P.x - s0.position.x, P.y - s0.position.y, P.z - s0.position.z), angErr: H.qang(app.rig.quaternion, s0.quaternion) };
      await H.frames(3); // afterwards the ground clearance may lift a street-level pose by the terrain refinement (µm–mm)
      res.posErrAfter3Frames = Math.hypot(P.x - s0.position.x, P.y - s0.position.y, P.z - s0.position.z);
      return res`);
    // a real building from the city generator (the city renderer may still be a stub: focus / enter use the spec)
    R.building = await run(`const { tileAt } = await import('/src/core/geo.js'); const { latLonToUnit } = await import('/src/core/geo.js');
      let spec = null;
      for (const [la, lo] of [[22.30, 118.60], [22.28, 118.62], [22.0, 118.0], [21.9, 118.3]]) {
        const u = latLonToUnit(la, lo); const t = tileAt(u.x, u.y, u.z, 13);
        const data = await app.workers.submit('cityTile', { face: t.face, x: t.x, y: t.y }, { priority: -50 }).promise;
        const list = (data && data.buildings) || [];
        spec = list.find((b) => b.floors >= 3 && b.entrances && b.entrances.length) || list[0] || null;
        if (spec) break;
      }
      window.__CH_SPEC__ = spec;
      return spec ? { id: spec.id, use: spec.use, floors: spec.floors, heading: spec.heading, lat: spec.lat, lon: spec.lon, ent: spec.entrances && spec.entrances[0] } : null`);
    if (R.building) {
      R.focus = await run(`const spec = window.__CH_SPEC__;
        const r = await c.focusBuilding(spec.id, { spec }); await H.settle(); const fm = c.modes.focus;
        const res = { arrived: r && r.arrived, mode: c.modeName, shown: app.state.mode, hAG: H.r3(c.heightAboveGround(true)) };
        await H.tap('Digit2'); await H.until(() => !fm.isMoving(), 6000);
        const wrap = (a) => ((a % 360) + 540) % 360 - 180;
        res.backAzErr = H.r3(wrap(fm.az * 180 / Math.PI - (spec.heading + 180)));
        await H.tap('Digit5'); await H.until(() => !fm.isMoving(), 6000); res.roofEl = H.r3(fm.el * 180 / Math.PI);
        await H.tap('Digit1'); await H.until(() => !fm.isMoving(), 6000); res.frontAzErr = H.r3(wrap(fm.az * 180 / Math.PI - spec.heading));
        return res`);
      await run('await H.idle(30000)');
      await shot(page, 'm07_focus_front.png');
      R.enter = await run(`const spec = window.__CH_SPEC__; const r = await c.enterBuilding(spec.id, { spec }); await H.frames(10);
        const { entrancePose } = await import('/src/controls/modes/focus.js'); const info = c.modes.focus.info;
        const ent = entrancePose(info, 'main'); const P = app.rig.position;
        const d = Math.hypot(P.x - ent.pos.x, P.y - ent.pos.y, P.z - ent.pos.z);
        const f = app.rig.forward(); const facing = -(f.x * ent.out.x + f.y * ent.out.y + f.z * ent.out.z);
        return { arrived: r && r.arrived, mode: c.modeName, distToDoor: H.r3(d), facingDoor: H.r3(facing), eyeAboveGround: H.r3(c.heightAboveGround(true)) }`);
      await run('await H.idle(30000)');
      await shot(page, 'm08_enter_door.png');
    }
    // UI integration: the mode bar 步行 button shows walk immediately (no "cannot switch" toast)
    R.uiWalk = await run(`await c.flyTo({ lat: 22.31, lon: 118.61, alt: 1500, heading: 10, pitch: -35 }, { duration: 1, mode: 'orbit' }); await H.settle();
      const ui = app.systems.ui; const toasts = []; const orig = ui && ui.toast && ui.toast.show.bind(ui.toast);
      if (orig) ui.toast.show = (t, o) => { toasts.push(t); return orig(t, o); };
      const btn = document.querySelector('.mui-modes [data-value="walk"]'); if (!btn) return { skipped: 'no ui button' };
      btn.click(); await H.frames(3); const shown = app.state.mode; const during = c.modeName;
      await H.until(() => !c.transition && c.modeName === 'walk', 12000); await H.frames(6);
      if (orig) ui.toast.show = orig;
      return { shownAfter3Frames: shown, activeDuring: during, final: c.modeName, toasts, hAG: H.r3(c.heightAboveGround(true)) }`);
    R.agl = await run(`const g = c.groundHeightAt(22.305, 118.605);
      const r = await c.flyTo({ lat: 22.305, lon: 118.605, agl: 1.65, heading: 90, pitch: 0 }, { mode: 'walk', duration: 1.2 }); await H.frames(10);
      return { arrived: r.arrived, mode: c.modeName, eyeAboveGround: H.r3(app.rig.geo.h - g) }`);
    R.flyPath = await run(`const pts = [{ lat: 22.4, lon: 118.7, alt: 6000, heading: 0, pitch: -40 }, { lat: 22.6, lon: 118.9, alt: 30000, heading: 45, pitch: -60 }, { lat: 23.0, lon: 119.5, alt: 2.0e5, heading: 90, pitch: -80, lens: 50 }];
      const want = c.resolveTarget(pts[2]); const t0 = performance.now(); const r = await c.flyPath(pts, { duration: 6, mode: 'orbit' }); const P = app.rig.position;
      return { arrived: r.arrived, secs: H.r3((performance.now() - t0) / 1000), posErr: Math.hypot(P.x - want.position.x, P.y - want.position.y, P.z - want.position.z), angErr: H.qang(app.rig.quaternion, want.quaternion), mode: c.modeName }`);
    R.pole = await run(`await c.flyTo({ lat: 86, lon: 20, alt: 1.2e6, heading: 0, pitch: -90 }, { duration: 1.5 }); await H.idle(20000);
      let worst = 0, roll = 0, valid = true; const lats = [];
      for (let k = 0; k < 3; k++) { const d = await H.dragCheck(0.5, 0.22, 0.5, 0.78); worst = Math.max(worst, d.pxErrMax); roll = Math.max(roll, Math.abs(d.roll)); valid = valid && d.valid; lats.push(H.r3(app.rig.geo.lat)); }
      return { pxErrMax: worst, rollMax: roll, valid, lats }`);
    R.tab = await run(`await c.flyTo({ lat: 22.3, lon: 118.6, alt: 400, heading: 0, pitch: -40 }, { duration: 1, mode: 'orbit' }); await H.settle();
      const seq = []; for (let i = 0; i < 3; i++) { await H.tap('Tab'); await H.until(() => !c.transition, 12000); await H.settle(); seq.push(c.modeName); }
      return { seq }`);
    R.pick = await run(`await c.flyTo({ lat: 22.3, lon: 118.6, alt: 3000, heading: 0, pitch: -60 }, { duration: 1, mode: 'orbit' }); await H.idle(30000);
      const sel = []; const hov = []; const o1 = app.events.on('select', (s) => sel.push(s)); const o2 = app.events.on('hover', (h) => hov.push(h));
      const r = H.rc(); const x = Math.round(r.left + r.width * 0.55), y = Math.round(r.top + r.height * 0.6);
      H.ptr('pointerdown', x, y); H.ptr('pointerup', x, y); await H.frames(25);
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 40, clientY: y, pointerType: 'mouse', buttons: 0, bubbles: true })); await H.frames(25);
      el.dispatchEvent(new PointerEvent('pointerleave', { clientX: x + 40, clientY: y, pointerType: 'mouse', buttons: 0, bubbles: false })); await H.frames(3);
      o1(); o2(); const s = sel[0];
      return { sel: s && { type: s.type, province: s.province, zone: s.zone, lat: H.r3(s.lat), lon: H.r3(s.lon), h: H.r3(s.h) }, hoverTypes: hov.map((h) => h && h.type), hoverClearedOnLeave: hov.length > 0 && hov[hov.length - 1] === null }`);
    // water: grab / pick the water surface (not the sea floor seen through it); never drop into deep water
    R.water = await run(`await c.flyTo({ lookAt: { lat: 5, lon: 105, h: 0 }, range: 900, heading: 20, tilt: 55 }, { duration: 2, mode: 'orbit' }); await H.idle(40000);
      const r = H.rc(); const x = Math.round(r.left + r.width * 0.5), y = Math.round(r.top + r.height * 0.6);
      const sel = c.pick(x, y); const s = H.surf(x, y);
      const d = await H.dragCheck(0.45, 0.62, 0.62, 0.48);
      c.setMode('walk'); await H.frames(3); await H.until(() => !c.transition, 12000); await H.frames(5);
      const w = c.modes.walk; const g = app.rig.geo;
      const res = { sel: sel && { type: sel.type, waterLevel: sel.waterLevel, depth: H.r3(sel.depth), h: H.r3(sel.h) }, surfKind: s.kind, drag: d, after: { mode: c.modeName, shown: app.state.mode, inWater: c.modeName === 'walk' ? w.info.inWater : null, depthAtFeet: c.modeName === 'walk' ? H.r3(c.ground.waterLevelAt(w.feet, 0.5) - w.info.terrainH) : null } };
      if (c.modeName !== 'orbit') { c.setMode('orbit', { pushBack: false }); await H.frames(3); }
      return res`);
    R.homeBack = await run(`const r = await c.home({ duration: 2 }); const p = app.rig.getPose(); return { arrived: r.arrived, altKm: H.r3(p.alt / 1000), pitch: H.r3(p.pitch), mode: c.modeName }`);
    await run('await H.idle(30000)');
    await shot(page, 'm09_home.png');
    R.perf = await run('return { controlsMsEMA: H.r3(c.perf.ms), controlsMsMax: H.r3(c.perf.max), fps: H.r3(app.fps) }');
    await ctx.close();

    const ok = (r) => r && !r.skipped;
    check('main: zoom at orbit altitude keeps the cursor point fixed (< 0.5 px)', R.zoomOrbit.pxErrMax < 0.5, R.zoomOrbit);
    check('main: regional zoom in / out keeps the cursor point fixed (< 0.5 px), auto-tilt engaged', R.zoomRegion.in.pxErrMax < 0.5 && R.zoomRegion.out.pxErrMax < 0.5 && R.zoomRegion.in.pitch > -89.9, R.zoomRegion);
    check('main: drag keeps the grabbed point under the cursor (< 0.5 px regional, < 1 px over the canyon)', R.dragRegion.pxErrMax < 0.5 && R.canyon.drag.pxErrMax < 1 && R.canyon.fly.posErr < 1e-6, { region: R.dragRegion, canyon: R.canyon });
    check('main: flyTo arrives exactly', R.flyExact.arrived && R.flyExact.posErr < 1e-6 && R.flyExact.angErr < 1e-6, R.flyExact);
    check('main: dive to the ground keeps 1.7 m clearance, no NaN, no roll', R.dive.minHAG >= 1.69 && !R.dive.nan && Math.abs(R.dive.roll) < 0.01, R.dive);
    // (the dive may end on a roof edge when a building stands in the way: then "low" = within 15 % of the start height)
    check('main: wheel on the sky near the ground dollies forward and stays low', R.skyWheel.horizontal > 5 && R.skyWheel.h1 < Math.max(6, R.skyWheel.h0 * 1.15), R.skyWheel);
    // (on a street the walker stands on the city's kerb / pavement colliders, a few cm above the terrain mesh)
    check('main: walking stays on the ground (feet error < 1 cm, eye 1.65 m above the terrain / pavement it stands on)', R.walk.mode === 'walk' && R.walk.groundErrMax < 0.01 && (Math.abs(R.walk.eyeAboveDisplayedGround - 1.65) < 0.05 || (R.walk.kind !== 'terrain' && Math.abs((R.walk.eyeAboveStandingSurface ?? 0) - 1.65) < 0.02 && R.walk.eyeAboveDisplayedGround > 1.6 && R.walk.eyeAboveDisplayedGround < 2.1)) && R.walk.speed < 0.5, R.walk);
    check('main: back() restores pose + mode exactly', R.back.arrived && R.back.modeOk && R.back.posErr < 1e-6 && R.back.angErr < 1e-6 && R.back.posErrAfter3Frames < 0.01, R.back);
    if (R.building) {
      check('main: focusBuilding(spec) → focus mode, back / roof / front presets', R.focus.mode === 'focus' && Math.abs(R.focus.backAzErr) < 1 && Math.abs(R.focus.roofEl - 72) < 1 && Math.abs(R.focus.frontAzErr) < 1 && R.focus.hAG >= 1.69, R.focus);
      check('main: enterBuilding → walk mode at the main entrance facing the door', R.enter.mode === 'walk' && R.enter.distToDoor < 5.5 && R.enter.facingDoor > 0.9, R.enter);
    }
    if (ok(R.uiWalk)) check('main: UI 步行 button shows walk at once (no error toast) and lands in walk mode', R.uiWalk.shownAfter3Frames === 'walk' && R.uiWalk.final === 'walk' && !R.uiWalk.toasts.length, R.uiWalk);
    check('main: agl target puts the eye 1.65 m above the ground', R.agl.arrived && R.agl.mode === 'walk' && Math.abs(R.agl.eyeAboveGround - 1.65) < 0.03, R.agl);
    check('main: flyPath passes 3 waypoints and arrives exactly', R.flyPath.arrived && R.flyPath.posErr < 1e-6 && R.flyPath.angErr < 1e-6, R.flyPath);
    check('main: dragging across the pole — no flip, no roll, grab exact', R.pole.valid && R.pole.rollMax < 0.01 && R.pole.pxErrMax < 0.5, R.pole);
    check('main: Tab cycles orbit → fly → walk → orbit', R.tab.seq.join(',') === 'fly,walk,orbit', R.tab);
    check('main: click selects a terrain location (province, zone); hover clears on leave', R.pick.sel && R.pick.sel.type === 'location' && R.pick.sel.province >= 1 && R.pick.hoverClearedOnLeave, R.pick);
    check('main: water surface is what you grab and pick (depth reported); walk drop never lands in deep water', R.water.surfKind === 'water' && R.water.sel && R.water.sel.waterLevel != null && R.water.sel.depth > 0 && R.water.drag.pxErrMax < 0.5 &&
      ((R.water.after.mode === 'walk' && !R.water.after.inWater && R.water.after.depthAtFeet <= 0.6) || (R.water.after.mode === 'orbit' && R.water.after.shown === 'orbit')), R.water);
    check('main: home() returns to the orbit view over the same lat/lon', R.homeBack.arrived && Math.abs(R.homeBack.altKm - 9500) < 1 && R.homeBack.pitch < -89.9, R.homeBack);
    }
    if (suite === 'city') await ctx.close();
  }
} catch (e) {
  report.errors.push('runner: ' + (e.stack || e));
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 20000))]);
  if (server) await server.close();
}
clearInterval(saver); clearTimeout(watchdog); saveReport();
const failed = report.checks.filter((c) => !c.ok);
console.log(JSON.stringify(report, null, 1));
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed` + (failed.length ? `; FAILED: ${failed.map((f) => f.name).join(' | ')}` : ''));
process.exit(0);
