/**
 * In-app updates.
 *  - Web / installed PWA: compare the running build with version.json on the
 *    server; if newer, ask the service worker to update and reload.
 *  - Android APK: compare with the "apk-latest" GitHub release; if newer, open
 *    the APK so the system installer updates the app in place (same signing
 *    key keeps all data). Android does not allow a sideloaded app to replace
 *    itself silently, so this is one confirmation tap.
 */
import { url } from './content.js';
import { isNative } from './native.js';
import { h, dialog, fmtBytes, fmtDate } from './ui.js';

export const BUILD = __APP_BUILD__; // { version, sha, fullSha, builtAt, buildNumber }
export const REPO = import.meta.env.VITE_REPO || 'Death7310/Mae-s-Medical-Tome';
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/maes-medical-tome.apk`;
const LAST_KEY = 'mmt:lastUpdateCheck';

export const updates = { checking: false, available: null, error: null, lastCheck: Number(safeGet(LAST_KEY) || 0), swRegistration: null };
const bus = new EventTarget();
export const onUpdates = (fn) => { bus.addEventListener('change', fn); return () => bus.removeEventListener('change', fn); };
const emit = () => bus.dispatchEvent(new CustomEvent('change'));
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

const sameCommit = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

export async function checkForUpdate() {
  if (updates.checking) return updates;
  updates.checking = true; updates.error = null; emit();
  try {
    if (isNative()) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/apk-latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const rel = await r.json();
      const sha = (/commit ([0-9a-f]{7,40})/i.exec(rel.body || '') || [])[1] || null;
      const asset = (rel.assets || []).find((a) => a.name.endsWith('.apk'));
      const newer = sha && !sameCommit(sha, BUILD.fullSha) && asset && (!BUILD.builtAt || new Date(asset.updated_at) > new Date(BUILD.builtAt));
      updates.available = newer ? { kind: 'apk', sha: sha.slice(0, 7), publishedAt: asset.updated_at, size: asset.size, url: asset.browser_download_url || APK_URL, notes: rel.body || '' } : null;
    } else {
      const r = await fetch(url('version.json') + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(`Server answered ${r.status}`);
      const v = await r.json();
      const newer = v.sha && !sameCommit(v.fullSha || v.sha, BUILD.fullSha) && (!BUILD.builtAt || !v.builtAt || new Date(v.builtAt) > new Date(BUILD.builtAt));
      updates.available = newer ? { kind: 'web', ...v } : null;
      if (updates.available) try { await updates.swRegistration?.update(); } catch { /* offline or no SW */ }
    }
  } catch (e) {
    updates.error = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the update server. Are you online?' : e.message;
  }
  updates.checking = false; updates.lastCheck = Date.now(); safeSet(LAST_KEY, String(updates.lastCheck)); emit();
  return updates;
}

/** Apply the pending update. Resolves when the page is about to reload (web) or the installer has been opened (apk). */
export async function applyUpdate() {
  const a = updates.available;
  if (!a) return false;
  if (a.kind === 'apk') {
    try { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url: a.url }); } catch { window.open(a.url, '_blank'); }
    return true;
  }
  // web: make sure the new service worker is fetched, then reload when it takes control
  let reloaded = false;
  const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });
  try {
    const reg = updates.swRegistration || (await navigator.serviceWorker?.getRegistration());
    if (reg) { await reg.update(); reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); }
  } catch { /* fall through to a plain reload */ }
  setTimeout(reload, 6000);
  return true;
}

/** Check at most every 6 hours, only when online. */
export async function autoCheck() {
  if (!navigator.onLine) return;
  if (Date.now() - updates.lastCheck < 6 * 3600 * 1000) return;
  await checkForUpdate();
}

/**
 * Interactive check: runs the check and always ends in a dialog that says
 * what happened and what the learner can do about it.
 */
export async function checkInteractively() {
  const progress = dialog({ title: 'Checking for updates…', body: h('p', { class: 'muted' }, 'Asking the server which version is the newest.') });
  await checkForUpdate();
  progress.close();
  if (updates.error) {
    const r = await dialog({ title: 'Could not check for updates', kind: 'warn', body: h('div', {}, h('p', {}, updates.error), h('p', { class: 'muted small' }, `You are running ${buildLabel()}.`)), actions: [{ id: 'retry', label: 'Try again', primary: true }, { id: 'ok', label: 'Close' }] }).done;
    if (r === 'retry') return checkInteractively();
    return;
  }
  const a = updates.available;
  if (!a) {
    await dialog({ title: 'You are up to date', kind: 'ok', body: h('div', {}, h('p', {}, `This is the newest version: ${buildLabel()}.`), h('p', { class: 'muted small' }, 'The app checks again on its own when you open it, and shows a banner if something new has been published.')), actions: [{ id: 'ok', label: 'OK', primary: true }] }).done;
    return;
  }
  const what = a.kind === 'apk'
    ? h('div', {}, h('p', {}, `A newer build of the app is available: ${a.sha}, published ${fmtDate(a.publishedAt)}${a.size ? ` (${fmtBytes(a.size)})` : ''}.`), h('p', {}, 'Android will download it and ask you to confirm the install. Your book, slides, notes and progress are kept.'), a.notes ? h('details', { class: 'small' }, h('summary', {}, 'Release notes'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, a.notes.slice(0, 1200))) : null)
    : h('div', {}, h('p', {}, `A newer version is available: ${a.sha}${a.buildNumber ? ` (build ${a.buildNumber})` : ''}, published ${fmtDate(a.builtAt)}.`), h('p', {}, 'Updating takes a few seconds and reloads the app. Nothing you stored is touched.'), h('p', { class: 'muted small' }, `You are running ${buildLabel()}.`));
  const r = await dialog({ title: 'Update available', kind: 'ok', body: what, actions: [{ id: 'update', label: a.kind === 'apk' ? 'Download and install' : 'Update now', primary: true }, { id: 'later', label: 'Later' }] }).done;
  if (r === 'update') await applyInteractively();
}

/** Apply with visible progress and a fallback if nothing happens. */
export async function applyInteractively() {
  const a = updates.available;
  if (!a) return;
  if (a.kind === 'apk') {
    await applyUpdate();
    await dialog({ title: 'Installer opening', body: h('div', {}, h('p', {}, 'Android is downloading the new version. When the download finishes, open it from the notification and confirm the install.'), h('p', { class: 'small' }, 'If nothing happened, open this link in your browser: ', h('a', { href: a.url, target: '_blank', rel: 'noopener' }, 'latest APK'), '.')), actions: [{ id: 'ok', label: 'OK', primary: true }] }).done;
    return;
  }
  const p = dialog({ title: 'Updating…', body: h('p', { class: 'muted' }, 'Fetching the new version. The app reloads by itself when it is ready.') });
  await applyUpdate();
  setTimeout(() => { p.close(); dialog({ title: 'Reload needed', body: h('p', {}, 'The update was downloaded but the app did not reload on its own. Reload now to use it.'), actions: [{ id: 'reload', label: 'Reload', primary: true }] }).done.then(() => location.reload()); }, 9000);
}

export const buildLabel = () => `${BUILD.version}${BUILD.buildNumber ? ` build ${BUILD.buildNumber}` : ''} (${BUILD.sha}${BUILD.builtAt ? `, ${new Date(BUILD.builtAt).toLocaleDateString()}` : ''})`;
