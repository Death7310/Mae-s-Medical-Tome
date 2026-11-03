/**
 * Content façade used by the views. Everything comes from the library the
 * learner loaded. All enabled books are indexed together; a book higher in
 * the library order gets a priority weight, so when a slide matches passages
 * in several books the preferred book ranks first. Section refs are
 * "<bookId>/<chapterId>#<sectionId>".
 */
import { buildIndex, tokenize } from './search.js';
import { buildDfIndex, extractKeyTerms, splitSentences } from './coach.js';
import { library, loadLibrary } from './library.js';

export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
export const url = (rel) => BASE + rel.replace(/^\//, '');

export const content = { books: [], decks: [], sections: new Map(), index: null, dfIndex: null, ready: false };

/** Priority weight by position in the library: 1, .85, .72, .61 … */
export const priorityWeight = (rank) => Math.pow(0.85, rank);

export async function loadContent() {
  await loadLibrary();
  rebuild();
  return content;
}

export function rebuild() {
  content.books = library.books.map((meta) => ({ ...meta, data: library.bookData.get(meta.id) })).filter((b) => b.data);
  content.sections.clear();
  const docs = [];
  let rank = 0;
  for (const b of content.books) {
    const weight = b.enabled === false ? 0 : priorityWeight(rank++);
    for (const ch of b.data.chapters) for (const sec of ch.sections) {
      const ref = `${b.id}/${ch.id}#${sec.id}`;
      content.sections.set(ref, { ref, book: b, chapter: ch, section: sec });
      if (weight > 0 && !/^(references|bibliography|index|further reading)$/i.test(sec.title)) docs.push({ id: ref, title: `${ch.title} ${sec.title}`, text: sec.text, weight });
    }
  }
  content.index = docs.length ? buildIndex(docs) : null;
  content.dfIndex = docs.length ? buildDfIndex(docs.map((d) => d.text)) : null;
  content.decks = library.decks.map((meta) => {
    const data = library.deckData.get(meta.id);
    const deck = { ...meta, title: data?.title || meta.name, slides: (data?.slides || []).map((s) => ({ ...s })) };
    for (const s of deck.slides) s.sections = autoLinks(s);
    return deck;
  });
  content.ready = true;
}

/** Book sections whose wording matches a slide: top 3, relative score ≥ .55 and enough shared terms. */
export function autoLinks(slide) {
  if (!content.index) return [];
  const q = `${slide.title || ''} ${slide.title || ''} ${slide.text || ''}`;
  const need = Math.min(3, Math.max(2, Math.floor(new Set(tokenize(q)).size * 0.15)));
  return content.index.search(q, 6).filter((r) => r.rel >= 0.55 && r.matched >= need).slice(0, 3).map((r) => r.id);
}

export const sectionByRef = (ref) => content.sections.get(ref);
export const bookById = (id) => content.books.find((b) => b.id === id);
export const chapterById = (bookId, chId) => bookById(bookId)?.data.chapters.find((c) => c.id === chId);
export const allDecks = () => content.decks;
export const deckById = (id) => content.decks.find((d) => d.id === id);
export const hasBook = () => content.books.length > 0;
export const linkableBooks = () => content.books.filter((b) => b.enabled !== false);
export const readHref = (ref) => { const h = sectionByRef(ref); return h ? `#/read/${h.book.id}/${h.chapter.id}/${h.section.id}` : '#/read'; };

export function slidesForSection(ref, userLinks = {}) {
  const out = [];
  for (const d of content.decks) for (const s of d.slides) {
    const sid = `slide:${d.id}#${s.number}`;
    const auto = s.sections || [];
    const user = userLinks[sid]?.sections || [];
    if (auto.includes(ref) || user.includes(ref)) out.push({ deck: d, slide: s, user: !auto.includes(ref) });
  }
  return out;
}

export function suggestSections(text, k = 5) {
  if (!content.index || !text?.trim()) return [];
  return content.index.search(text, k).map((r) => ({ ...r, ...sectionByRef(r.id) }));
}

export function coachMaterial(refs, k = 10) {
  const hits = refs.map(sectionByRef).filter(Boolean);
  const texts = hits.map((h) => h.section.text);
  const terms = [];
  for (const t of texts) for (const term of extractKeyTerms(t, content.dfIndex, Math.ceil(k / Math.max(hits.length, 1)) + 2)) if (!terms.includes(term)) terms.push(term);
  return { texts, terms: terms.slice(0, k), titles: hits.map((h) => (content.books.length > 1 ? `${h.section.title} (${h.book.title})` : h.section.title)) };
}

/** Extractive explanation: the sentences of a section that best match the slide, in reading order. */
export function excerptsFor(slide, ref, n = 4) {
  const hit = sectionByRef(ref);
  if (!hit) return { sentences: [], terms: [] };
  const qTokens = new Set(tokenize(`${slide.title || ''} ${slide.text || ''}`));
  const idf = (t) => { const d = content.dfIndex?.df.get(t) || 1; return Math.log(1 + (content.dfIndex?.N || 1) / d); };
  const sentences = splitSentences(hit.section.text).map((s, i) => {
    const toks = new Set(tokenize(s));
    let score = 0; const shared = [];
    for (const t of toks) if (qTokens.has(t)) { score += idf(t); shared.push(t); }
    return { i, s, score: score / Math.sqrt(Math.max(toks.size, 4)), shared };
  });
  const top = sentences.filter((x) => x.score > 0 && x.shared.length >= 2).sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i);
  const terms = [...new Set(top.flatMap((x) => x.shared))];
  return { sentences: top.map((x) => x.s), terms, title: hit.section.title, chapter: hit.chapter, book: hit.book };
}

export function highlight(sentence, terms) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!terms.length) return esc(sentence);
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[a-z]*`, 'gi');
  return esc(sentence).replace(re, '<mark>$&</mark>');
}
