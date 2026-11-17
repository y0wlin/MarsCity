// Headless Chrome for the capture and diagnostic scripts: the system Chrome with the platform's native ANGLE
// backend (Metal on macOS, D3D11 on Windows), so the same scripts run on the Mac and on a Windows laptop.
//   CHROME_PATH=<chrome executable>   CHROME_ANGLE=metal|d3d11|vulkan|gl|swiftshader|default
// On a laptop with two GPUs, set chrome.exe to "High performance" in Windows graphics settings;
// capture-shots.mjs logs the WebGL renderer at start so a run on the integrated GPU or SwiftShader is visible.
import fs from 'fs';
import path from 'path';

const winRoots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
const CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  win32: winRoots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
};
const NATIVE_ANGLE = { darwin: 'metal', win32: 'd3d11' };

const candidates = CANDIDATES[process.platform] || [];
export const CHROME = process.env.CHROME_PATH || candidates.find((p) => fs.existsSync(p)) || candidates[0];
export const ANGLE = process.env.CHROME_ANGLE || NATIVE_ANGLE[process.platform] || 'default';
export const GPU_ARGS = [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];

// The WebGL renderer string of a page (e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M5, ...)").
export async function webglRenderer(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no WebGL2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return s;
  }).catch((e) => `unknown (${e.message})`);
}
