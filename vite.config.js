import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}
const fullSha = gitSha();
const build = {
  version: process.env.npm_package_version || '0.0.0',
  sha: fullSha.slice(0, 7),
  fullSha,
  builtAt: new Date().toISOString(),
  buildNumber: process.env.GITHUB_RUN_NUMBER ? Number(process.env.GITHUB_RUN_NUMBER) : 0,
};
/** Writes dist/version.json so a running app can ask "is there something newer?". */
const versionFile = () => ({ name: 'mmt-version-file', apply: 'build', writeBundle(opts) { fs.writeFileSync(path.join(opts.dir || 'dist', 'version.json'), JSON.stringify(build)); } });

// Set VITE_BASE when hosting under a sub-path, e.g. GitHub Pages: VITE_BASE=/Mae-s-Medical-Tome/
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  build: { target: 'es2022', sourcemap: false },
  define: { __APP_VERSION__: JSON.stringify(build.version), __APP_BUILD__: JSON.stringify(build) },
  plugins: [
    versionFile(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        id: 'maes-medical-tome',
        name: "Mae's Medical Tome",
        short_name: 'Medical Tome',
        description: 'The book, the slides, and explanations linking each slide to the book. Works offline on Windows, Android and Huawei.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f8fa',
        theme_color: '#0b3d5c',
        categories: ['education', 'medical', 'books'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Continue reading', url: base + '#/read', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Slides', url: base + '#/slides', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Sync', url: base + '#/sync', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,json,woff2}'],
        globIgnores: ['version.json'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: base + 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
