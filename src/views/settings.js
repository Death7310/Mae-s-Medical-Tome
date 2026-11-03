import { clear as clearIdb } from 'idb-keyval';
import { h, icon, toast, fmtBytes, fmtDate } from '../lib/ui.js';
import { content, importDeck, removeImportedDeck } from '../lib/content.js';
import { extractTextPerPage } from '../lib/pdf.js';
import { pref, setPref, getState } from '../lib/store.js';
import { app } from '../main.js';
import { DEFAULT_MODEL, askCoach } from '../lib/aicoach.js';

export async function render(root) {
  const sel = (key, options, def) => h('select', { onchange: (e) => setPref(key, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) }, ...options.map(([v, l]) => h('option', { value: v, selected: String(pref(key, def)) === String(v) }, l)));

  const importedList = h('div');
  const drawImported = () => {
    importedList.replaceChildren(content.imported.length ? h('table', { class: 'list' }, ...content.imported.map((d) => h('tr', {},
      h('td', {}, h('a', { href: `#/slides/${d.id}/1` }, d.title), h('div', { class: 'muted small' }, `${d.slides.length} pages · ${fmtBytes(d.bytes)} · added ${fmtDate(d.addedAt)}`)),
      h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm danger', onclick: async () => { if (confirm(`Remove "${d.title}" from this device? Your notes for it are kept.`)) { await removeImportedDeck(d.id); drawImported(); } } }, icon('trash'), 'Remove'))))) : h('p', { class: 'muted small' }, 'No imported decks on this device.'));
  };
  drawImported();
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, style: { display: 'none' }, onchange: async (e) => {
    for (const f of e.target.files) {
      toast(`Importing ${f.name}…`);
      try { const d = await importDeck(f, extractTextPerPage); toast(`Added "${d.title}" (${d.slides.length} pages)`, 'ok'); } catch (err) { toast(`Could not import ${f.name}: ${err.message}`, 'error', 6000); }
    }
    drawImported();
  } });

  const persist = h('button', { class: 'btn sm', onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage is now protected from automatic clean-up.' : 'The browser declined. Installing the app usually grants this.', ok ? 'ok' : 'error', 4500); } }, 'Protect stored data');

  root.replaceChildren(h('h1', {}, 'Settings'),
    h('div', { class: 'card' }, h('h2', {}, 'Appearance'),
      h('div', { class: 'row' }, h('label', { style: { minWidth: '8rem' } }, 'Theme'), sel('theme', [['system', 'Follow device'], ['light', 'Light'], ['dark', 'Dark']], 'system')),
      h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('label', { style: { minWidth: '8rem' } }, 'Reading size'), sel('readSize', [[0.95, 'Small'], [1.05, 'Normal'], [1.18, 'Large'], [1.32, 'Extra large']], 1.05))),
    h('div', { class: 'card' }, h('h2', {}, 'Import a slide deck'),
      h('p', { class: 'small' }, 'Add any lecture PDF. It is stored only on this device (PDFs are too large for sync codes), but the notes and book links you make for it do sync, and the "Find in book" tab works as long as the PDF contains real text rather than scanned images.'),
      h('button', { class: 'btn primary', onclick: () => fileIn.click() }, icon('download'), 'Choose PDF…'), fileIn,
      h('div', { style: { height: '.6rem' } }), importedList),
    h('div', { class: 'card' }, h('h2', {}, 'AI coach (optional)'),
      h('p', { class: 'small' }, 'The built-in check works offline and never leaves the device. For judgement a rule cannot make, whether your prose really says what the book says and whether the grammar reads well, you can add an Anthropic API key. The coach then reads only your answer and the linked book passages, is told not to give the answer away, and costs a fraction of a cent per check. The key is stored on this device only and is not included in sync codes.'),
      h('label', { class: 'small' }, 'API key'), h('input', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…', value: pref('aiKey', ''), onchange: (e) => setPref('aiKey', e.target.value.trim()) }),
      h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('label', { style: { minWidth: '8rem' } }, 'Model'), sel('aiModel', [[DEFAULT_MODEL, 'Claude Opus 5.5 (recommended)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)']], DEFAULT_MODEL)),
      h('div', { class: 'row', style: { marginTop: '.6rem' } }, h('button', { class: 'btn sm', onclick: async (e) => { const b = e.target.closest('button'); b.disabled = true; try { const r = await askCoach({ question: 'What is 2 + 2? (connection test)', answer: 'Four.', sectionTexts: ['Two plus two equals four.'], attempt: 3 }); toast(`Connected. Model ${r.model}.`, 'ok'); } catch (err) { toast(err.message, 'error', 6000); } b.disabled = false; } }, 'Test connection'),
        h('button', { class: 'btn sm danger', onclick: () => { setPref('aiKey', ''); toast('Key removed'); } }, 'Remove key'),
        h('a', { class: 'small', href: 'https://console.anthropic.com/', target: '_blank', rel: 'noopener' }, 'Get a key'))),
    h('div', { class: 'card' }, h('h2', {}, 'Install on this device'),
      installBlock()),
    h('div', { class: 'card' }, h('h2', {}, 'Data'),
      h('p', { class: 'small muted' }, 'Everything lives in this browser profile: your notes, progress, imported PDFs and offline files. Export a sync code before clearing or switching browsers.'),
      h('div', { class: 'row' }, persist,
        h('button', { class: 'btn sm danger', onclick: async () => { if (confirm('Delete ALL notes, progress, links, imported decks and offline files on this device? Export a sync code first if you want to keep them.')) { await clearIdb(); if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k); location.hash = '#/home'; location.reload(); } } }, icon('trash'), 'Clear everything'))),
    h('div', { class: 'card' }, h('h3', {}, 'About'),
      h('p', { class: 'small muted' }, `${content.book.title} · ${content.book.edition || ''}`, h('br'), `Content built ${content.manifest ? new Date(content.manifest.builtAt).toLocaleString() : 'n/a'} (${content.manifest?.contentHash || ''}) · app ${__APP_VERSION__}`, h('br'), 'Offline-first progressive web app. Works on Windows (Edge/Chrome), Android (Chrome) and Huawei (Huawei Browser), with no account and no server.'),
      h('button', { class: 'btn sm', onclick: () => app.updateSW ? app.updateSW(true) : location.reload() }, 'Check for updates')));
}

function installBlock() {
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
    h('p', { class: 'small muted' }, 'Once installed, open it once while online and press "Save everything offline" under Downloads if you want the PDFs available without a connection.'));
}
