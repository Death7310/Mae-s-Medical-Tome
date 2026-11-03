import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { loadState, onChange, pref, getState } from './lib/store.js';
import { loadContent } from './lib/content.js';
import { h, icon, toast } from './lib/ui.js';
import * as home from './views/home.js';
import * as reader from './views/reader.js';
import * as slides from './views/slides.js';
import * as downloads from './views/downloads.js';
import * as sync from './views/sync.js';
import * as settings from './views/settings.js';
import { updates, onUpdates, autoCheck, applyUpdate } from './lib/updates.js';

const routes = [
  { path: 'home', view: home, label: 'Library', icon: 'home' },
  { path: 'read', view: reader, label: 'Book', icon: 'book' },
  { path: 'slides', view: slides, label: 'Slides', icon: 'slides' },
  { path: 'downloads', view: downloads, label: 'Files', icon: 'download' },
  { path: 'sync', view: sync, label: 'Sync', icon: 'sync' },
  { path: 'settings', view: settings, label: 'Settings', icon: 'settings' },
];

export const app = { installPrompt: null, updateSW: null };
let cleanup = null;

function applyPrefs() {
  const theme = pref('theme', 'system');
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--read-size', `${pref('readSize', 1.05)}rem`);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: segs[0] || 'home', params: segs.slice(1), query: new URLSearchParams(query) };
}

function navLinks(cls) {
  const { path } = parseHash();
  return routes.map((r) => h('a', { href: `#/${r.path}`, class: `${cls}${path === r.path ? ' active' : ''}`, 'aria-current': path === r.path ? 'page' : null }, icon(r.icon), h('span', {}, r.label)));
}

function drawUpdateBanner() {
  const host = document.getElementById('update-banner');
  if (!host) return;
  const a = updates.available;
  if (!a) { host.replaceChildren(); return; }
  const btn = h('button', { class: 'btn sm primary', onclick: async () => { btn.disabled = true; btn.textContent = a.kind === 'apk' ? 'Opening installer…' : 'Updating…'; await applyUpdate(); } }, a.kind === 'apk' ? 'Download and install' : 'Update now');
  host.replaceChildren(h('div', { class: 'update-banner' }, h('span', {}, a.kind === 'apk' ? `A newer version of the app is available (${a.sha}).` : `A new version is available (${a.sha}). It installs in a few seconds and keeps your data.`), btn, h('a', { href: '#/settings', class: 'small' }, 'Details')));
}

function renderShell() {
  const root = document.getElementById('app');
  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/home' }, icon('book'), "Mae's Medical Tome"),
      h('nav', { id: 'topnav', 'aria-label': 'Main' }, navLinks(''))),
    h('div', { id: 'update-banner' }),
    h('main', { id: 'view' }),
    h('nav', { class: 'bottomnav', id: 'bottomnav', 'aria-label': 'Main' }, navLinks('')),
  );
}

async function route() {
  const { path, params, query } = parseHash();
  const r = routes.find((x) => x.path === path) || routes[0];
  if (typeof cleanup === 'function') { try { cleanup(); } catch {} }
  cleanup = null;
  document.getElementById('topnav').replaceChildren(...navLinks(''));
  document.getElementById('bottomnav').replaceChildren(...navLinks(''));
  const view = document.getElementById('view');
  view.replaceChildren();
  window.scrollTo(0, 0);
  try {
    cleanup = await r.view.render(view, params, query);
  } catch (e) {
    console.error(e);
    view.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, String(e?.message || e))));
  }
}

async function boot() {
  await loadState();
  applyPrefs();
  onChange(applyPrefs);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);
  renderShell();
  try { await loadContent(); } catch (e) { console.error('library load failed', e); }
  window.addEventListener('hashchange', route);
  if (!location.hash) location.replace('#/home');
  await route();

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); app.installPrompt = e; window.dispatchEvent(new CustomEvent('mmt:installable')); });
  window.addEventListener('appinstalled', () => { app.installPrompt = null; toast('Installed. You can now open Medical Tome from your home screen or Start menu.', 'ok', 5000); });

  onUpdates(drawUpdateBanner);
  setTimeout(autoCheck, 4000);
  window.addEventListener('online', () => autoCheck());
  app.updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) { updates.swRegistration = registration || null; },
    onNeedRefresh() {
      const t = h('div', { class: 'toast show', style: { pointerEvents: 'auto' } }, 'A new version is ready. ', h('button', { class: 'btn sm primary', onclick: () => app.updateSW(true) }, 'Reload'));
      let host = document.getElementById('toasts'); if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
      host.append(t);
    },
    onOfflineReady() { toast('Ready to work offline.', 'ok'); },
  });
}

boot();
