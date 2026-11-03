import { get, set } from 'idb-keyval';
import { h, icon, toast, fmtBytes } from '../lib/ui.js';
import { content, url } from '../lib/content.js';
import { isNative, saveAndShare } from '../lib/native.js';

const CACHE = 'mmt-downloads';
const OFFLINE_KEY = 'mmt:offline'; // { [path]: sha256 }

async function offlineMap() { return (await get(OFFLINE_KEY)) || {}; }
async function isCached(path) {
  if (!('caches' in window)) return false;
  const c = await caches.open(CACHE);
  return !!(await c.match(url(path), { ignoreSearch: true }));
}
async function saveOffline(file) {
  const c = await caches.open(CACHE);
  const res = await fetch(url(file.path), { cache: 'reload' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await c.put(url(file.path), res);
  const m = await offlineMap(); m[file.path] = file.sha256; await set(OFFLINE_KEY, m);
}
async function removeOffline(file) {
  const c = await caches.open(CACHE);
  await c.delete(url(file.path), { ignoreSearch: true });
  const m = await offlineMap(); delete m[file.path]; await set(OFFLINE_KEY, m);
}

export async function render(root) {
  const man = content.manifest;
  if (!man) { root.replaceChildren(h('div', { class: 'card' }, h('p', {}, 'No download manifest was built. Run npm run content.'))); return; }
  const canShareFiles = !!(navigator.canShare && navigator.share);
  const native = isNative();
  const stored = await offlineMap();

  const groups = [
    { title: content.book.title, sub: 'The book', files: man.files.filter((f) => f.kind === 'book') },
    ...man.decks.map((d) => ({ title: d.title, sub: `Slide deck · ${d.slides} slides`, files: man.files.filter((f) => f.kind === 'deck' && f.deck === d.id) })),
    { title: 'Everything', sub: 'Bundles', files: man.files.filter((f) => f.kind === 'decks') },
  ].filter((g) => g.files.length);

  const rowsByPath = new Map();
  const row = (f) => {
    const status = h('span', { class: 'chip' }, '…');
    const offBtn = h('button', { class: 'btn sm' }, icon('offline'), 'Save offline');
    const tr = h('tr', {},
      h('td', {}, h('div', {}, h('b', {}, f.label)), h('div', { class: 'muted small' }, `${fmtBytes(f.bytes)} · ${f.path.split('/').pop()}`)),
      h('td', { style: { textAlign: 'right' } }, h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        native ? h('span', { class: 'chip ok' }, icon('check'), 'in the app') : status,
        native
          ? h('button', { class: 'btn sm primary', onclick: async (e) => { const b = e.target.closest('button'); b.disabled = true; try { const blob = await (await fetch(url(f.path))).blob(); await saveAndShare(blob, f.path.split('/').pop(), f.label); } catch (err) { if (!/cancel/i.test(err.message)) toast(`Could not save: ${err.message}`, 'error'); } b.disabled = false; } }, icon('download'), 'Save / share')
          : h('a', { class: 'btn sm primary', href: url(f.path), download: f.path.split('/').pop() }, icon('download'), 'Download'),
        native ? null : offBtn,
        !native && canShareFiles ? h('button', { class: 'btn sm', title: 'Share (e-mail, messaging…)', onclick: () => shareFile(f) }, icon('share'), 'Share') : null)));
    const refresh = async () => {
      if (native) return;
      const cached = await isCached(f.path);
      const stale = cached && stored[f.path] && stored[f.path] !== f.sha256;
      status.className = `chip ${cached ? (stale ? 'warn' : 'ok') : ''}`;
      status.replaceChildren(...(cached ? (stale ? ['update available'] : [icon('check'), 'offline']) : ['online only']));
      offBtn.replaceChildren(icon(cached ? 'trash' : 'offline'), cached ? (stale ? 'Update' : 'Remove') : 'Save offline');
      offBtn.onclick = async () => {
        offBtn.disabled = true;
        try {
          if (cached && !stale) { await removeOffline(f); toast('Removed from offline storage'); }
          else { await saveOffline(f); stored[f.path] = f.sha256; toast(`${f.label} saved for offline use`, 'ok'); }
        } catch (e) { toast(`Failed: ${e.message}`, 'error'); }
        offBtn.disabled = false; refresh();
      };
    };
    rowsByPath.set(f.path, refresh);
    refresh();
    return tr;
  };

  const all = h('button', { class: 'btn', onclick: async () => {
    all.disabled = true;
    let ok = 0;
    for (const f of man.files) { try { await saveOffline(f); stored[f.path] = f.sha256; ok++; } catch {} }
    all.disabled = false;
    toast(`${ok} of ${man.files.length} files saved offline`, 'ok');
    rowsByPath.forEach((r) => r());
  } }, icon('offline'), 'Save everything offline');

  const est = h('span', { class: 'muted small' });
  if (navigator.storage?.estimate) navigator.storage.estimate().then((e) => { est.textContent = `Using ${fmtBytes(e.usage || 0)} of ${fmtBytes(e.quota || 0)} available on this device`; });

  root.replaceChildren(
    h('h1', {}, 'Downloads'),
    h('div', { class: 'card' },
      native
        ? h('p', {}, 'Every format is generated from the same source, so they always match. All files are packaged inside the app, so they are always available offline. ', h('b', {}, 'Save / share'), ' opens the Android share sheet: save to Files or Drive, send by e-mail, or open in a PDF or EPUB reader.')
        : h('p', {}, 'Every format is generated from the same source, so they always match. ', h('b', {}, 'Download'), ' saves a copy to your Downloads folder for use in any other app. ', h('b', {}, 'Save offline'), ' keeps it inside this app so it opens with no connection.'),
      native ? null : h('div', { class: 'row' }, all, est),
      h('p', { class: 'muted small' }, `Built ${new Date(man.builtAt).toLocaleString()} · content ${man.contentHash}`)),
    ...groups.map((g) => h('div', { class: 'card' }, h('h2', {}, g.title), h('div', { class: 'muted small', style: { marginTop: '-.5rem', marginBottom: '.5rem' } }, g.sub), h('table', { class: 'list' }, ...g.files.map(row)))),
    h('div', { class: 'card' }, h('h3', {}, 'Which format when?'),
      h('ul', { class: 'small' },
        h('li', {}, h('b', {}, 'PDF'), ': fixed layout, prints well, opens everywhere.'),
        h('li', {}, h('b', {}, 'EPUB'), ': reflowable text for e-readers and phone reading apps (Google Play Books, Huawei Books, Apple Books, Calibre).'),
        h('li', {}, h('b', {}, 'ZIP'), ': all formats plus the Markdown source in one archive, for backup or editing.'),
        h('li', {}, h('b', {}, 'PPTX'), ': the deck as editable PowerPoint slides.'),
        h('li', {}, h('b', {}, 'HTML / Markdown'), ': plain, searchable, easy to paste into other tools.'))));
}

async function shareFile(f) {
  try {
    const blob = await (await fetch(url(f.path))).blob();
    const file = new File([blob], f.path.split('/').pop(), { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: f.label });
    else toast('Sharing files is not supported here. Use Download instead.', 'error');
  } catch (e) { if (e.name !== 'AbortError') toast(`Share failed: ${e.message}`, 'error'); }
}
