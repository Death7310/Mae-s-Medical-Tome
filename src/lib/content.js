/** Loads built content (book, decks, manifest) and manages user-imported decks. */
import { get, set, del } from 'idb-keyval';
import { buildIndex } from './search.js';

export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
export const url = (rel) => BASE + rel.replace(/^\//, '');

export const content = { book: null, decks: [], manifest: null, sections: new Map(), index: null, imported: [] };

export async function loadContent() {
  const [book, decks, manifest] = await Promise.all([
    fetch(url('content/book.json')).then((r) => r.json()),
    fetch(url('content/decks.json')).then((r) => r.json()).catch(() => ({ decks: [] })),
    fetch(url('content/manifest.json')).then((r) => r.json()).catch(() => null),
  ]);
  content.book = book;
  content.decks = decks.decks || [];
  content.manifest = manifest;
  content.sections.clear();
  const docs = [];
  for (const ch of book.chapters) {
    for (const sec of ch.sections) {
      const ref = `${ch.id}#${sec.id}`;
      content.sections.set(ref, { ref, chapter: ch, section: sec });
      if (!/^references$/i.test(sec.title)) docs.push({ id: ref, title: `${ch.title} ${sec.title}`, text: sec.text });
    }
  }
  content.index = buildIndex(docs);
  content.imported = (await get('mmt:imported')) || [];
  return content;
}

export const sectionByRef = (ref) => content.sections.get(ref);
export const chapterById = (id) => content.book?.chapters.find((c) => c.id === id);
export const allDecks = () => [...content.decks, ...content.imported.map((d) => ({ ...d, imported: true }))];
export const deckById = (id) => allDecks().find((d) => d.id === id);

/** Built-in slide -> book links, plus reverse map section -> slides. */
export function slidesForSection(ref, userLinks = {}) {
  const out = [];
  for (const d of allDecks()) {
    for (const s of d.slides || []) {
      const sid = `slide:${d.id}#${s.number}`;
      const built = s.sections || [];
      const user = userLinks[sid]?.sections || [];
      if (built.includes(ref) || user.includes(ref)) out.push({ deck: d, slide: s, user: !built.includes(ref) });
    }
  }
  return out;
}

export function suggestSections(text, k = 5) {
  if (!content.index || !text?.trim()) return [];
  return content.index.search(text, k).map((r) => ({ ...r, ...sectionByRef(r.id) }));
}

// ---- imported decks (PDF chosen by the user, stored locally, never synced as binary)
export async function importDeck(file, extractText) {
  const id = 'imp-' + Math.random().toString(36).slice(2, 10);
  const buf = await file.arrayBuffer();
  const pages = await extractText(buf);
  const deck = {
    id,
    title: file.name.replace(/\.pdf$/i, ''),
    source: 'imported.pdf',
    addedAt: Date.now(),
    bytes: buf.byteLength,
    slides: pages.map((text, i) => ({ number: i + 1, title: (text.split('\n')[0] || `Slide ${i + 1}`).slice(0, 80), text, sections: [], explanationHtml: '' })),
    files: {},
  };
  await set(`mmt:deckblob:${id}`, new Blob([buf], { type: 'application/pdf' }));
  content.imported = [...content.imported, deck];
  await set('mmt:imported', content.imported);
  return deck;
}
export async function removeImportedDeck(id) {
  content.imported = content.imported.filter((d) => d.id !== id);
  await set('mmt:imported', content.imported);
  await del(`mmt:deckblob:${id}`);
}
export const importedBlob = (id) => get(`mmt:deckblob:${id}`);
