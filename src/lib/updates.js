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

export const buildLabel = () => `${BUILD.version}${BUILD.buildNumber ? ` build ${BUILD.buildNumber}` : ''} (${BUILD.sha}${BUILD.builtAt ? `, ${new Date(BUILD.builtAt).toLocaleDateString()}` : ''})`;
