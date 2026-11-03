/**
 * The library: the one book and the slide decks the learner has loaded,
 * stored in IndexedDB. Ids are content hashes so that the same files loaded
 * on two devices produce the same ids, which is what lets notes and links sync.
 */
import { get, set, del, keys } from 'idb-keyval';
import { parseBookFile, parseDeckFile, restructurePdf } from './parsers/index.js';

const META = 'mmt:lib:v1';
export const library = { book: null, decks: [], bookData: null, deckData: new Map(), pdfCache: null };

async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function loadLibrary() {
  const meta = (await get(META)) || { book: null, decks: [] };
  library.book = meta.book;
  library.decks = meta.decks || [];
  library.bookData = library.book ? await get(`mmt:lib:book:${library.book.id}:parsed`) : null;
  library.pdfCache = null;
  library.deckData = new Map();
  for (const d of library.decks) library.deckData.set(d.id, await get(`mmt:lib:deck:${d.id}:parsed`));
  if (!library.bookData && library.book) { library.book = null; }
  library.decks = library.decks.filter((d) => library.deckData.get(d.id));
  return library;
}
const saveMeta = () => set(META, { book: library.book, decks: library.decks });

export async function setBookFromFile(file, { onProgress, prefer } = {}) {
  const buf = await file.arrayBuffer();
  const id = await sha256(buf);
  const { book, meta, pdfCache } = await parseBookFile(new File([buf], file.name, { type: file.type }), { onProgress, prefer });
  if (!book.chapters.length) throw new Error('No readable text was found in this file. If it is a scanned PDF, run it through OCR first.');
  if (library.book) await removeBook({ keepState: true });
  await set(`mmt:lib:book:${id}:blob`, new Blob([buf], { type: file.type || 'application/octet-stream' }));
  await set(`mmt:lib:book:${id}:parsed`, book);
  if (pdfCache) await set(`mmt:lib:book:${id}:pdfcache`, pdfCache);
  library.book = { id, name: file.name, size: buf.byteLength, addedAt: Date.now(), kind: meta.kind, inner: meta.inner, mode: meta.mode, available: meta.available || [], pageCount: meta.pageCount, title: book.title, chapters: book.chapters.length, sections: book.chapters.reduce((a, c) => a + c.sections.length, 0) };
  library.bookData = book;
  library.pdfCache = pdfCache || null;
  await saveMeta();
  return library.book;
}

/** Switch a PDF book between outline / headings / pages structure. */
export async function restructureBook(mode) {
  if (!library.book) return;
  const cache = library.pdfCache || (await get(`mmt:lib:book:${library.book.id}:pdfcache`));
  if (!cache) throw new Error('This book format has a fixed structure.');
  library.pdfCache = cache;
  const { book, mode: used } = restructurePdf(cache, mode);
  if (!book) throw new Error(`Structure "${mode}" is not available for this file.`);
  await set(`mmt:lib:book:${library.book.id}:parsed`, book);
  library.bookData = book;
  Object.assign(library.book, { mode: used, chapters: book.chapters.length, sections: book.chapters.reduce((a, c) => a + c.sections.length, 0) });
  await saveMeta();
}

export async function removeBook() {
  if (!library.book) return;
  const id = library.book.id;
  for (const k of [`mmt:lib:book:${id}:blob`, `mmt:lib:book:${id}:parsed`, `mmt:lib:book:${id}:pdfcache`]) await del(k);
  library.book = null; library.bookData = null; library.pdfCache = null;
  await saveMeta();
}

export async function addDecksFromFile(file, { onProgress } = {}) {
  const decks = await parseDeckFile(file, { onProgress });
  const added = [];
  for (const d of decks) {
    if (!d.slides.length) continue;
    const id = await sha256(await d.blob.arrayBuffer());
    if (library.decks.some((x) => x.id === id)) continue; // already loaded
    const parsed = { title: d.name, kind: d.kind, slides: d.slides };
    await set(`mmt:lib:deck:${id}:blob`, d.blob);
    await set(`mmt:lib:deck:${id}:parsed`, parsed);
    const meta = { id, name: d.name, kind: d.kind, size: d.blob.size, addedAt: Date.now(), slides: d.slides.length, textSlides: d.slides.filter((s) => s.text.trim()).length };
    library.decks.push(meta);
    library.deckData.set(id, parsed);
    added.push(meta);
  }
  await saveMeta();
  return added;
}

export async function removeDeck(id) {
  await del(`mmt:lib:deck:${id}:blob`); await del(`mmt:lib:deck:${id}:parsed`);
  library.decks = library.decks.filter((d) => d.id !== id);
  library.deckData.delete(id);
  await saveMeta();
}

export const bookBlob = () => (library.book ? get(`mmt:lib:book:${library.book.id}:blob`) : null);
export const deckBlob = (id) => get(`mmt:lib:deck:${id}:blob`);

export async function clearLibrary() {
  for (const k of await keys()) if (String(k).startsWith('mmt:lib:')) await del(k);
  library.book = null; library.bookData = null; library.decks = []; library.deckData = new Map(); library.pdfCache = null;
}

// ---------------------------------------------------------------- exports (generated from the parsed book, in the browser)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BOOK_CSS = `body{font-family:Georgia,"Times New Roman",serif;line-height:1.55;max-width:42em;margin:2em auto;padding:0 1.2em;color:#1b1b1b}h1{font-size:1.8em;margin-top:2em;page-break-before:always}h1.title{page-break-before:avoid}h2{font-size:1.3em;margin-top:1.6em;border-bottom:1px solid #ccc;padding-bottom:.2em}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:.3em .6em}.toc ol{padding-left:1.2em}@media print{body{max-width:none;margin:0}}`;

export function bookToMarkdown(book) {
  return `# ${book.title}\n\n` + book.chapters.map((c) => `# ${c.title}\n\n` + c.sections.map((s) => `## ${s.title}\n\n${s.text}`).join('\n\n')).join('\n\n') + '\n';
}
export function bookToHtml(book) {
  const toc = book.chapters.map((c) => `<li><a href="#${c.id}">${esc(c.title)}</a><ol>${c.sections.map((s) => `<li><a href="#${c.id}--${s.id}">${esc(s.title)}</a></li>`).join('')}</ol></li>`).join('');
  const body = book.chapters.map((c) => `<section id="${c.id}"><h1>${esc(c.title)}</h1>${c.sections.map((s) => `<div id="${c.id}--${s.id}"><h2>${esc(s.title)}</h2>${s.html}</div>`).join('')}</section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(book.title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BOOK_CSS}</style></head><body><h1 class="title">${esc(book.title)}</h1><nav class="toc"><h2>Contents</h2><ol>${toc}</ol></nav>${body}</body></html>`;
}
const xhtmlify = (html) => html.replace(/<(br|hr|img[^>]*?)(?<!\/)>/g, '<$1/>').replace(/&nbsp;/g, '&#160;').replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
export async function bookToEpub(book) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/style.css', BOOK_CSS);
  const page = (title, inner) => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${inner}</body></html>`;
  const items = [], spine = [], nav = [];
  zip.file('OEBPS/title.xhtml', page(book.title, `<h1 class="title">${esc(book.title)}</h1>`));
  items.push('<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>'); spine.push('<itemref idref="title"/>');
  book.chapters.forEach((c, i) => {
    const f = `ch-${String(i + 1).padStart(3, '0')}.xhtml`;
    zip.file(`OEBPS/${f}`, page(c.title, `<h1>${esc(c.title)}</h1>` + c.sections.map((s) => `<div id="${s.id}"><h2>${esc(s.title)}</h2>${xhtmlify(s.html)}</div>`).join('')));
    items.push(`<item id="c${i}" href="${f}" media-type="application/xhtml+xml"/>`); spine.push(`<itemref idref="c${i}"/>`);
    nav.push(`<li><a href="${f}">${esc(c.title)}</a><ol>${c.sections.map((s) => `<li><a href="${f}#${s.id}">${esc(s.title)}</a></li>`).join('')}</ol></li>`);
  });
  zip.file('OEBPS/nav.xhtml', page('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>${nav.join('')}</ol></nav>`));
  const uid = `urn:mmt:${library.book?.id || 'book'}`;
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${esc(book.title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${items.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}
export function deckToMarkdown(deck) {
  return `# ${deck.title}\n\n` + deck.slides.map((s) => `## Slide ${s.number}: ${s.title}\n\n${s.text}`).join('\n\n---\n\n') + '\n';
}
