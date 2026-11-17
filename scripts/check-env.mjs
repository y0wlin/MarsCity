#!/usr/bin/env node
// Pre-flight check for a capture machine (Mac or Windows): Node, the build, Chrome, RAM, CPU, and the WebGL renderer
// headless Chrome actually gets - on a hybrid-GPU laptop it must be the discrete GPU, not the iGPU or SwiftShader.
// Launches ONE headless Chrome for a few seconds (under scripts/slot.mjs if anything else may be capturing).
//   node scripts/check-env.mjs            (--no-browser: skip the Chrome / WebGL check)
import os from 'os';
import fs from 'fs';
import { CHROME, ANGLE, GPU_ARGS, webglRenderer } from './chrome.mjs';

const GB = 2 ** 30;
const gb = (b) => (b / GB).toFixed(1);
let bad = 0;
const line = (tag, msg, hint) => console.log(`${tag} ${msg}${hint ? `\n     -> ${hint}` : ''}`);
const ok = (cond, msg, hint) => { line(cond ? 'OK  ' : 'FAIL', msg, cond ? '' : hint); if (!cond) bad++; };
const warn = (cond, msg, hint) => line(cond ? 'OK  ' : 'WARN', msg, cond ? '' : hint);

const [maj, min] = process.versions.node.split('.').map(Number);
ok(maj > 20 || (maj === 20 && min >= 19), `Node ${process.versions.node}`, 'Vite 8 needs Node 20.19 or newer (Node 24 LTS recommended)');
// node_modules must be installed on THIS machine: Vite's bundler and CSS tools ship per-OS native bindings
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const natives = [...ls('node_modules'), ...ls('node_modules/@rolldown').map((n) => `@rolldown/${n}`)]
  .filter((n) => /(binding|lightningcss)-(darwin|linux|win32|freebsd|android)-/.test(n));
const mine = natives.filter((n) => n.includes(`${process.platform}-${process.arch}`));
ok(fs.existsSync('node_modules/vite') && fs.existsSync('node_modules/playwright-core') && (!natives.length || mine.length > 0),
  `node_modules for ${process.platform}-${process.arch}${mine.length ? ` (${mine.join(', ')})` : ''}`,
  'run npm ci in this folder (a node_modules folder copied from another computer does not work)');
ok(fs.existsSync('dist/index.html'), 'dist/ is built', 'run: npm run build');
ok(fs.existsSync('public/data/manifest.json'), 'public/data present', 'unpack the complete project package (public/data holds the world maps)');
ok(!!CHROME && fs.existsSync(CHROME), `Chrome: ${CHROME}`, 'install Google Chrome, or set CHROME_PATH to chrome.exe');
const cpus = os.cpus();
console.log(`     ${process.platform} ${os.release()} | ${cpus[0]?.model?.trim()} x${cpus.length} | ANGLE ${ANGLE}`);
warn(os.totalmem() >= 15 * GB, `RAM ${gb(os.totalmem())} GB`, 'under 16 GB: capture with &workers=3 and nothing else running');
warn(os.freemem() >= 9 * GB, `free RAM ${gb(os.freemem())} GB`, 'close other apps (browsers, games, launchers) before a long capture');
if (!bad && !process.argv.includes('--no-browser')) {
  // imported here, so a missing node_modules is reported above instead of crashing the check
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GPU_ARGS });
  try {
    const page = await (await browser.newContext()).newPage();
    const r = await webglRenderer(page);
    const soft = /SwiftShader|Basic Render|llvmpipe|Software/i.test(r);
    const igpu = /Intel/i.test(r) && !/NVIDIA|AMD|Radeon|Apple/i.test(r);
    ok(!soft && !igpu && r !== 'no WebGL2', `WebGL renderer: ${r}`, igpu
      ? 'Chrome runs on the integrated GPU: set chrome.exe to "High performance" in Settings > System > Display > Graphics, or switch the laptop to discrete-GPU mode, then run this check again'
      : 'no hardware WebGL2: update the GPU driver and check chrome://gpu');
    console.log(`     Chrome ${browser.version()}`);
  } finally {
    await Promise.race([browser.close().catch(() => {}), new Promise((res) => setTimeout(res, 15000))]);
  }
}
console.log(bad ? `\n${bad} problem(s): fix them before capturing.` : '\nReady to capture.');
process.exit(bad ? 1 : 0);
