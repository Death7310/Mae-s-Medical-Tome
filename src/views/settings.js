import { clear as clearIdb } from 'idb-keyval';
import { h, icon, toast, fmtBytes, fmtDate } from '../lib/ui.js';
import { content } from '../lib/content.js';
import { library } from '../lib/library.js';
import { pref, setPref, getState } from '../lib/store.js';
import { app } from '../main.js';
import { DEFAULT_MODEL, askCoach } from '../lib/aicoach.js';
import { isNative } from '../lib/native.js';
import { updates, onUpdates, checkInteractively, applyInteractively, buildLabel, APK_URL } from '../lib/updates.js';

export async function render(root) {
  const sel = (key, options, def) => h('select', { onchange: (e) => setPref(key, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(pref(key, def)) === String(v) }, l)));

  const persist = h('button', { class: 'btn sm', onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage is now protected from automatic clean-up.' : 'The browser declined. Installing the app usually grants this.', ok ? 'ok' : 'error', 4500); } }, 'Protect stored data');

  root.replaceChildren(h('h1', {}, 'Settings'),
    h('div', { class: 'card' }, h('h2', {}, 'Appearance'),
      h('div', { class: 'row' }, h('label', { style: { minWidth: '8rem' } }, 'Theme'), sel('theme', [['system', 'Follow device'], ['light', 'Light'], ['dark', 'Dark']], 'system')),
      h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('label', { style: { minWidth: '8rem' } }, 'Reading size'), sel('readSize', [[0.95, 'Small'], [1.05, 'Normal'], [1.18, 'Large'], [1.32, 'Extra large']], 1.05))),
    h('div', { class: 'card' }, h('h2', {}, 'AI coach (optional)'),
      h('p', { class: 'small' }, 'The built-in check works offline and never leaves the device. For judgement a rule cannot make, whether your prose really says what the book says and whether the grammar reads well, you can add an Anthropic API key. The coach then reads only your answer and the linked book passages, is told not to give the answer away, and costs a fraction of a cent per check. The key is stored on this device only and is not included in sync codes.'),
      h('label', { class: 'small' }, 'API key'), h('input', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…', value: pref('aiKey', ''), onchange: (e) => setPref('aiKey', e.target.value.trim()) }),
      h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('label', { style: { minWidth: '8rem' } }, 'Model'), sel('aiModel', [[DEFAULT_MODEL, 'Claude Opus 5.5 (recommended)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)']], DEFAULT_MODEL)),
      h('div', { class: 'row', style: { marginTop: '.6rem' } }, h('button', { class: 'btn sm', onclick: async (e) => { const b = e.target.closest('button'); b.disabled = true; try { const r = await askCoach({ question: 'What is 2 + 2? (connection test)', answer: 'Four.', sectionTexts: ['Two plus two equals four.'], attempt: 3 }); toast(`Connected. Model ${r.model}.`, 'ok'); } catch (err) { toast(err.message, 'error', 6000); } b.disabled = false; } }, 'Test connection'),
        h('button', { class: 'btn sm danger', onclick: () => { setPref('aiKey', ''); toast('Key removed'); } }, 'Remove key'),
        h('a', { class: 'small', href: 'https://console.anthropic.com/', target: '_blank', rel: 'noopener' }, 'Get a key'))),
    updatesCard(),
    h('div', { class: 'card' }, h('h2', {}, 'Install on this device'),
      installBlock()),
    h('div', { class: 'card' }, h('h2', {}, 'Data'),
      h('p', { class: 'small muted' }, 'Everything lives on this device: your book and slides, notes, answers and progress. Export a sync code before clearing or switching browsers.'),
      h('div', { class: 'row' }, persist,
        h('button', { class: 'btn sm danger', onclick: async () => { if (confirm('Delete the loaded book and slides and ALL notes, answers, progress and links on this device? Export a sync code first if you want to keep them.')) { await clearIdb(); if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k); location.hash = '#/home'; location.reload(); } } }, icon('trash'), 'Clear everything'))),
    h('div', { class: 'card' }, h('h3', {}, 'About'),
      h('p', { class: 'small muted' }, content.book ? `Book: ${content.book.title} (${library.book?.name})` : 'No book loaded', h('br'), `App ${__APP_VERSION__}`, h('br'), 'Offline-first progressive web app. Works on Windows (Edge/Chrome), Android (Chrome) and Huawei (Huawei Browser), with no account and no server.'),
      ));
}

function updatesCard() {
  const status = h('div', { class: 'small', style: { marginTop: '.5rem' } });
  const actions = h('div', { class: 'row', style: { marginTop: '.5rem' } });
  const draw = () => {
    const a = updates.available;
    status.replaceChildren(
      updates.checking ? h('span', { class: 'muted' }, 'Checking…')
        : updates.error ? h('span', { class: 'notice warn small' }, updates.error)
        : a ? h('span', { class: 'notice ok small' }, a.kind === 'apk' ? `Update available: build ${a.sha}, published ${fmtDate(a.publishedAt)}. Tap "Download and install": Android downloads the new APK and asks you to confirm; your book, notes and progress are kept.` : `Update available: ${a.sha}${a.buildNumber ? ` (build ${a.buildNumber})` : ''}, published ${fmtDate(a.builtAt)}. It installs in a few seconds.`)
        : updates.lastCheck ? h('span', { class: 'muted' }, `You have the latest version. Last checked ${fmtDate(updates.lastCheck)}.`)
        : h('span', { class: 'muted' }, 'Not checked yet.'));
    const checkBtn = h('button', { class: 'btn sm primary', disabled: updates.checking, onclick: () => checkInteractively() }, icon('sync'), 'Check for updates');
    const applyBtn = a ? h('button', { class: 'btn sm ok', onclick: () => applyInteractively() }, icon('download'), a.kind === 'apk' ? 'Download and install' : 'Update now') : null;
    actions.replaceChildren(...[checkBtn, applyBtn].filter(Boolean));
  };
  draw();
  const off = onUpdates(draw);
  const card = h('div', { class: 'card' }, h('h2', {}, 'Updates'),
    h('p', { class: 'small muted' }, `This version: ${buildLabel()}.`),
    h('p', { class: 'small' }, isNative()
      ? 'The app checks the project\'s releases for a newer build when it starts (at most every few hours) and shows a banner. Updating replaces the app in place and keeps everything stored on the phone.'
      : 'The app checks for a newer version when it starts (at most every few hours) and shows a banner. Updates install through the browser\'s service worker; nothing you stored is touched.'),
    actions, status,
    isNative() ? null : h('p', { class: 'small muted', style: { marginTop: '.6rem' } }, 'Android app: ', h('a', { href: APK_URL }, 'download the latest APK'), '.'));
  card.addEventListener('DOMNodeRemoved', () => {}, { once: true });
  window.addEventListener('hashchange', off, { once: true });
  return card;
}

function installBlock() {
  if (isNative()) return h('p', { class: 'notice ok' }, 'You are using the Android app. Updates: download the newest APK from the project\'s Releases page and install it over this one; your data is kept.');
  if (matchMedia('(display-mode: standalone)').matches) return h('p', { class: 'notice ok' }, 'Installed. You are running the app in its own window.');
  const items = [
    ['Windows (Edge or Chrome)', 'Open this page, then click the install icon at the right end of the address bar (or menu → Apps → Install Mae\'s Medical Tome). It gets a Start-menu entry and its own window.'],
    ['Android (Chrome)', 'Menu (⋮) → "Add to Home screen" or "Install app". It then opens full-screen from the home screen, offline.'],
    ['Huawei / HarmonyOS (Huawei Browser)', 'Menu → "Add to" → "Home screen". No Google services are needed. If prompted, allow the browser to keep site data.'],
    ['iPhone / iPad (Safari)', 'Share → "Add to Home Screen".'],
  ];
  return h('div', {},
    app.installPrompt ? h('button', { class: 'btn primary', style: { marginBottom: '.6rem' }, onclick: async () => { app.installPrompt.prompt(); await app.installPrompt.userChoice; app.installPrompt = null; } }, icon('download'), 'Install now') : null,
    h('ul', { class: 'small' }, ...items.map(([t, d]) => h('li', {}, h('b', {}, t), ': ', d))),
    h('p', { class: 'small muted' }, 'Once installed, the app and everything you load into it work without a connection.'));
}
