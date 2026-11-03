import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState, mergeState, splitForQr, createChunkCollector, b64urlEncode, b64urlDecode, normaliseCode } from '../src/lib/sync.js';

const sample = {
  notes: { 'slide:cv-physiology#3': { text: 'CO = HR x SV', updatedAt: 1000 } },
  bookmarks: { 'book:cardiac-cycle#heart-sounds': { on: true, updatedAt: 1000 } },
  studied: {},
  progress: { lastBook: { chapter: 'cardiac-cycle', section: 'heart-sounds', updatedAt: 1000 } },
  userLinks: { 'slide:cv-physiology#6': { sections: ['cardiac-cycle#heart-sounds'], updatedAt: 1000 } },
  prefs: { theme: 'dark' },
};

test('base64url round trip, all byte values and lengths', () => {
  for (let len = 0; len < 10; len++) {
    const bytes = new Uint8Array(len).map((_, i) => (i * 73 + 11) % 256);
    assert.deepEqual(Array.from(b64urlDecode(b64urlEncode(bytes))), Array.from(bytes));
  }
  const all = new Uint8Array(256).map((_, i) => i);
  assert.deepEqual(Array.from(b64urlDecode(b64urlEncode(all))), Array.from(all));
});

test('encode/decode round trip keeps sync collections and drops prefs', () => {
  const code = encodeState(sample, 'Phone');
  assert.match(code, /^MMT1\.[0-9a-f]{8}\.[A-Za-z0-9\-_]+\.$/);
  const back = decodeState(code);
  assert.equal(back.device, 'Phone');
  assert.deepEqual(back.notes, sample.notes);
  assert.deepEqual(back.userLinks, sample.userLinks);
  assert.equal(back.prefs, undefined);
});

test('decode tolerates e-mail line wrapping and surrounding text', () => {
  const code = encodeState(sample);
  const wrapped = 'Here is my code:\n' + code.replace(/(.{40})/g, '$1\r\n ') + '\nSent from my phone';
  assert.deepEqual(decodeState(wrapped).notes, sample.notes);
  assert.equal(normaliseCode(wrapped), code.slice(0, -1));
  assert.deepEqual(decodeState(code.slice(0, -1)).notes, sample.notes); // terminator lost but nothing follows
  assert.deepEqual(decodeState(code + 'thanks, Mae').notes, sample.notes); // text glued straight after the terminator
  assert.deepEqual(decodeState('see below\n' + code).notes, sample.notes);
});

test('corrupted or truncated codes are rejected', () => {
  const code = encodeState(sample);
  assert.throws(() => decodeState(code.slice(0, -6)), /checksum/);
  assert.throws(() => decodeState('hello'), /MMT1/);
  const bad = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
  assert.throws(() => decodeState(bad));
});

test('merge is last-write-wins per entry', () => {
  const local = { ...sample, notes: { a: { text: 'old', updatedAt: 1 }, b: { text: 'local-newer', updatedAt: 9 } } };
  const incoming = { notes: { a: { text: 'new', updatedAt: 5 }, b: { text: 'remote-older', updatedAt: 3 }, c: { text: 'added', updatedAt: 2 } } };
  const { merged, summary } = mergeState(local, incoming);
  assert.equal(merged.notes.a.text, 'new');
  assert.equal(merged.notes.b.text, 'local-newer');
  assert.equal(merged.notes.c.text, 'added');
  assert.deepEqual(summary.byCollection.notes, { added: 1, updated: 1, kept: 1 });
  assert.deepEqual(merged.bookmarks, sample.bookmarks); // untouched collections survive
});

test('QR chunking reassembles in any order', () => {
  const big = { ...sample, notes: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`slide:d#${i}`, { text: 'note '.repeat(20) + i, updatedAt: i }])) };
  const code = encodeState(big);
  const chunks = splitForQr(code, 500);
  assert.ok(chunks.length > 1);
  const col = createChunkCollector();
  for (const c of [...chunks].reverse()) col.add(c);
  const st = col.status();
  assert.equal(st.done, true);
  assert.equal(st.code, code);
  assert.deepEqual(decodeState(st.code).notes, big.notes);
  assert.deepEqual(splitForQr('MMT1.x.y.'), ['MMT1.x.y.']);
});
