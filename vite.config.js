import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync } from 'fs';

// Every html file in ./dev is an extra page (module test benches), plus the main index.html.
const devPages = {};
// `npm run build` ships only the app; private agent builds (`npx vite build`) keep the benches. npm sets
// npm_lifecycle_event on every platform (a `MARS_PROD=1 vite build` script does not run under cmd.exe).
const ship = !!process.env.MARS_PROD || process.env.npm_lifecycle_event === 'build';
if (!ship) {
  try { for (const f of readdirSync(resolve(import.meta.dirname, 'dev'))) if (f.endsWith('.html')) devPages[`dev-${f.replace('.html', '')}`] = resolve(import.meta.dirname, 'dev', f); } catch { /* none */ }
}

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), ...devPages } },
  },
  server: { fs: { allow: ['..'] } },
});
