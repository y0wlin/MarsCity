// Isolated dev server for terrain verification (no HMR: other engineers' edits must not reload the
// page mid-capture). Usage (from web/): npx vite --config src/render/terrain/tools/vite.bench.config.js --port 5185 --strictPort
// OWNER: terrain-render agent.
import { fileURLToPath } from 'url';
import path from 'path';
import base from '../../../../vite.config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export default { ...base, root, server: { ...(base.server || {}), hmr: false } };
