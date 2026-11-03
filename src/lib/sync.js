/**
 * Server-free sync codec.
 *
 * A device's study data (notes, bookmarks, studied flags, reading position,
 * user-made slide links) is serialised to JSON, deflated, base64url-encoded
 * and wrapped as  MMT1.<checksum>.<payload>.  (the final dot is a terminator
 * so that text pasted after the code, e.g. an e-mail signature, is ignored).
 * The code can travel by any
 * channel: clipboard, e-mail, chat message, a .mmt file, or one or more QR
 * codes. Importing merges per item by last-write-wins on `updatedAt`.
 *
 * Pure module: works in Node (tests) and in the browser.
 */
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

export const CODE_PREFIX = 'MMT1';
export const CHUNK_PREFIX = 'MMTQ';
export const SYNC_COLLECTIONS = ['notes', 'bookmarks', 'studied', 'progress', 'userLinks'];

// ---- base64url without Buffer/btoa differences
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function b64urlEncode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += b === undefined ? '' : B64[(n >> 6) & 63];
    out += c === undefined ? '' : B64[n & 63];
  }
  return out;
}
export function b64urlDecode(str) {
  const clean = str.replace(/[^A-Za-z0-9\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    if (v.some((x) => x < 0)) throw new Error('Invalid character in code');
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** FNV-1a 32-bit, as 8 hex chars. Catches typos / truncation, not tampering. */
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Pick the syncable subset of app state. */
export function exportableState(state, device = '') {
  const out = { v: 1, at: Date.now(), device };
  for (const c of SYNC_COLLECTIONS) out[c] = state[c] || {};
  return out;
}

export function encodeState(state, device = '') {
  const json = JSON.stringify(exportableState(state, device));
  const payload = b64urlEncode(deflateSync(strToU8(json), { level: 9 }));
  return `${CODE_PREFIX}.${checksum(payload)}.${payload}.`;
}

/**
 * Extract the canonical code (MMT1.<sum>.<payload>, no terminator) from
 * arbitrary text: tolerates line wrapping and spaces inside the code and
 * text before/after it. Without a terminator we fall back to a greedy match.
 */
export function normaliseCode(text) {
  const t = String(text);
  const strip = (s) => s.replace(/\s+/g, '');
  let m = /MMT1\s*\.\s*([0-9a-f]{8})\s*\.\s*([A-Za-z0-9\-_\s]+?)\s*\./.exec(t);
  if (!m) m = /MMT1\s*\.\s*([0-9a-f]{8})\s*\.\s*([A-Za-z0-9\-_\s]+)/.exec(t);
  if (!m) return strip(t).replace(/\.$/, '');
  return `${CODE_PREFIX}.${m[1]}.${strip(m[2])}`;
}

export function decodeState(text) {
  const code = normaliseCode(text);
  const parts = code.split('.');
  if (parts.length !== 3 || parts[0] !== CODE_PREFIX) throw new Error('Not a Medical Tome sync code (expected it to start with MMT1.)');
  const [, sum, payload] = parts;
  if (checksum(payload) !== sum) throw new Error('The code is damaged or incomplete (checksum mismatch). Copy it again in full.');
  let json;
  try { json = strFromU8(inflateSync(b64urlDecode(payload))); } catch { throw new Error('The code could not be decompressed.'); }
  const data = JSON.parse(json);
  if (data.v !== 1) throw new Error(`Unsupported sync version ${data.v}`);
  for (const c of SYNC_COLLECTIONS) if (data[c] && typeof data[c] !== 'object') throw new Error(`Malformed section ${c}`);
  return data;
}

/**
 * Merge incoming export into local state. Every entry is {updatedAt, ...}.
 * Newer wins; ties keep local. Returns the merged collections and a summary.
 */
export function mergeState(local, incoming) {
  const merged = {};
  const summary = { added: 0, updated: 0, kept: 0, byCollection: {} };
  for (const c of SYNC_COLLECTIONS) {
    const L = { ...(local[c] || {}) };
    const I = incoming[c] || {};
    const s = { added: 0, updated: 0, kept: 0 };
    for (const [k, v] of Object.entries(I)) {
      if (!v || typeof v !== 'object') continue;
      const cur = L[k];
      if (!cur) { L[k] = v; s.added++; }
      else if ((v.updatedAt || 0) > (cur.updatedAt || 0)) { L[k] = v; s.updated++; }
      else s.kept++;
    }
    merged[c] = L;
    summary.byCollection[c] = s;
    summary.added += s.added; summary.updated += s.updated; summary.kept += s.kept;
  }
  return { merged, summary };
}

/** Preview what an import would change without applying it. */
export function diffState(local, incoming) {
  return mergeState(local, incoming).summary;
}

// ---- QR chunking. QR version 40 (L) holds ~2.9 KB; keep chunks well under.
export function splitForQr(code, size = 1000) {
  if (code.length <= size) return [code];
  const n = Math.ceil(code.length / size);
  return Array.from({ length: n }, (_, i) => `${CHUNK_PREFIX}.${i + 1}/${n}.${code.slice(i * size, (i + 1) * size)}`);
}

/** Feed scanned strings; returns {done, have, total, code?}. */
export function createChunkCollector() {
  const parts = new Map();
  let total = 0;
  return {
    add(text) {
      const t = String(text).trim();
      if (t.startsWith(CODE_PREFIX + '.')) { parts.clear(); total = 1; parts.set(1, t); return this.status(); }
      const m = new RegExp(`^${CHUNK_PREFIX}\\.(\\d+)/(\\d+)\\.(.*)$`, 's').exec(t);
      if (!m) throw new Error('Not a Medical Tome QR code');
      const [, i, n, body] = m;
      if (total && total !== Number(n)) { parts.clear(); }
      total = Number(n);
      parts.set(Number(i), body);
      return this.status();
    },
    status() {
      const done = total > 0 && parts.size === total;
      const code = done ? Array.from({ length: total }, (_, i) => parts.get(i + 1)).join('') : undefined;
      return { done, have: parts.size, total, code, missing: Array.from({ length: total }, (_, i) => i + 1).filter((i) => !parts.has(i)) };
    },
  };
}
