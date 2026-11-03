/** App state: one JSON blob in IndexedDB, change events, timestamped entries. */
import { get, set } from 'idb-keyval';

const KEY = 'mmt:state:v1';
const EMPTY = () => ({ notes: {}, bookmarks: {}, studied: {}, progress: {}, userLinks: {}, practice: {}, prefs: {}, syncLog: [] });
let state = EMPTY();
const bus = new EventTarget();
let saveTimer = null;

export const onChange = (fn) => { bus.addEventListener('change', fn); return () => bus.removeEventListener('change', fn); };
export const getState = () => state;

export async function loadState() {
  try {
    const saved = await get(KEY);
    if (saved && typeof saved === 'object') state = { ...EMPTY(), ...saved };
  } catch (e) { console.warn('IndexedDB unavailable, state will not persist', e); }
  return state;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => set(KEY, state).catch((e) => console.warn('save failed', e)), 150);
}

export function update(mutator) {
  mutator(state);
  persist();
  bus.dispatchEvent(new CustomEvent('change'));
}

export async function replaceState(next) {
  state = { ...EMPTY(), ...next };
  await set(KEY, state);
  bus.dispatchEvent(new CustomEvent('change'));
}

// ---- convenience accessors. Target ids: "book:<chapter>#<section>" | "slide:<deck>#<n>"
export const noteOf = (id) => state.notes[id]?.text || '';
export const isOn = (coll, id) => !!state[coll][id]?.on;
export const setNote = (id, text) => update((s) => { s.notes[id] = { text, updatedAt: Date.now() }; });
export const toggle = (coll, id) => update((s) => { s[coll][id] = { on: !s[coll][id]?.on, updatedAt: Date.now() }; });
export const setProgress = (key, value) => update((s) => { s.progress[key] = { ...value, updatedAt: Date.now() }; });
export const setUserLinks = (slideId, sections) => update((s) => { s.userLinks[slideId] = { sections, updatedAt: Date.now() }; });
export const userLinksOf = (slideId) => state.userLinks[slideId]?.sections || [];
export const pref = (k, d) => (state.prefs[k] === undefined ? d : state.prefs[k]);
export const setPref = (k, v) => update((s) => { s.prefs[k] = v; });
// practice[id] = { answer, attempts, band, covered, total, mastered, updatedAt }
export const practiceOf = (id) => state.practice[id] || null;
export const savePractice = (id, patch) => update((s) => { s.practice[id] = { ...(s.practice[id] || { attempts: 0 }), ...patch, updatedAt: Date.now() }; });
export const logSync = (entry) => update((s) => { s.syncLog = [{ at: Date.now(), ...entry }, ...(s.syncLog || [])].slice(0, 20); });

export function countOn(coll, prefix) {
  return Object.entries(state[coll]).filter(([k, v]) => v?.on && k.startsWith(prefix)).length;
}
