#!/usr/bin/env node
// Global headless-browser semaphore shared by parallel agents on this machine.
//   node scripts/slot.mjs [--slots 3] -- <command ...args>
// Waits until one of N slots is free (default 2, env MARS_SLOTS), runs the command, releases the
// slot when the command exits (also on SIGINT/SIGTERM). Stale slots (owner PID dead) are reclaimed.
// Wrap EVERY command that launches Chrome/Playwright (shot.mjs, capture-shots.mjs, verify/idle
// scripts, benches) so the machine never runs more than N browsers at once.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const head = dd < 0 ? [] : argv.slice(0, dd);
const cmd = dd < 0 ? argv : argv.slice(dd + 1);
if (!cmd.length) { console.error('usage: node scripts/slot.mjs [--slots N] -- <command...>'); process.exit(2); }
const si = head.indexOf('--slots');
// machine-wide hard cap (MARS_SLOT_CAP, default 1): a caller asking for more slots still gets at most this many
const SLOTS = Math.max(1, Math.min(+(si >= 0 ? head[si + 1] : process.env.MARS_SLOTS || 2), +(process.env.MARS_SLOT_CAP || 1)));
// project-local so every agent (whatever its TMPDIR) shares the same slots
const DIR = process.env.MARS_SLOT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.build/browser-slots');
fs.mkdirSync(DIR, { recursive: true });

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
let mine = null;
function release() { if (mine) { try { if (fs.readFileSync(mine, 'utf8').split(' ')[0] === String(process.pid)) fs.unlinkSync(mine); } catch { /* gone */ } mine = null; } }

async function acquire() {
  const t0 = Date.now(); let told = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const f = path.join(DIR, `slot${i}`);
      try { fs.writeFileSync(f, `${process.pid} ${new Date().toISOString()} ${cmd.join(' ').slice(0, 200)}`, { flag: 'wx' }); return f; } catch { /* taken */ }
      try {
        const pid = +fs.readFileSync(f, 'utf8').split(' ')[0];
        if (pid && !alive(pid)) fs.unlinkSync(f);   // stale: owner died without releasing
      } catch { /* raced */ }
    }
    if (!told && Date.now() - t0 > 3000) { console.error(`[slot] waiting for a free browser slot (${SLOTS} max) …`); told = true; }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

mine = await acquire();
const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: false });
const fwd = (sig) => () => { try { child.kill(sig); } catch { /* exited */ } };
process.on('SIGINT', fwd('SIGINT'));
process.on('SIGTERM', fwd('SIGTERM'));
process.on('exit', release);
child.on('exit', (code, sig) => { release(); process.exit(code ?? (sig ? 1 : 0)); });
child.on('error', (e) => { console.error(`[slot] ${e.message}`); release(); process.exit(127); });
