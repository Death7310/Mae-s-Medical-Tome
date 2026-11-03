/**
 * Content façade used by the views. Everything comes from the library the
 * learner loaded: the book is indexed for search and coaching, every slide is
 * linked to the book sections its text matches, and explanations are the
 * book's own sentences that match the slide.
 */
import { buildIndex, tokenize } from './search.js';
import { buildDfIndex, extractKeyTerms, splitSentences } from './coach.js';
import { library, loadLibrary } from './library.js';

export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
export const url = (rel) => BASE + rel.replace(/^\//, '');

export const content = { book: null, decks: [], sections: new Map(), index: null, dfIndex: null, ready: false };

export async function loadContent() {
  await loadLibrary();
  rebuild();
  return content;
}

/** Recompute indexes and auto-links after the library changes. */
export function rebuild() {
  content.book = library.bookData;
  content.sections.clear();
  const docs = [];
  if (content.book) {
    for (const ch of content.book.chapters) for (const sec of ch.sections) {
      const ref = `${ch.id}#${sec.id}`;
      content.sections.set(ref, { ref, chapter: ch, section: sec });
      if (!/^(references|bibliography|index|further reading)$/i.test(sec.title)) docs.push({ id: ref, title: `${ch.title} ${sec.title}`, text: sec.text });
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
  return content.index.search(q, 5).filter((r) => r.rel >= 0.55 && r.matched >= need).slice(0, 3).map((r) => r.id);
}

export const sectionByRef = (ref) => content.sections.get(ref);
export const chapterById = (id) => content.book?.chapters.find((c) => c.id === id);
export const allDecks = () => content.decks;
export const deckById = (id) => content.decks.find((d) => d.id === id);
export const hasBook = () => !!content.book;

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

/** Key terminology and plain text for a set of section refs (used by the coach). */
export function coachMaterial(refs, k = 10) {
  const hits = refs.map(sectionByRef).filter(Boolean);
  const texts = hits.map((h) => h.section.text);
  const terms = [];
  for (const t of texts) for (const term of extractKeyTerms(t, content.dfIndex, Math.ceil(k / Math.max(hits.length, 1)) + 2)) if (!terms.includes(term)) terms.push(term);
  return { texts, terms: terms.slice(0, k), titles: hits.map((h) => h.section.title) };
}

/**
 * Extractive explanation: the sentences of a section that best match the
 * slide, in reading order, with the shared terms marked for highlighting.
 */
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
  return { sentences: top.map((x) => x.s), terms, title: hit.section.title, chapter: hit.chapter };
}

/** Wrap matched terms in <mark>, safely. */
export function highlight(sentence, terms) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!terms.length) return esc(sentence);
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[a-z]*`, 'gi');
  return esc(sentence).replace(re, '<mark>$&</mark>');
}
