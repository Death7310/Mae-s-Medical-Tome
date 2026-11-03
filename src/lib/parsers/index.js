/**
 * One entry point per slot. Detects the format from the file name / magic
 * bytes and dispatches. ZIP archives are opened and the best candidate used
 * (for slides, every deck inside the archive is imported).
 */
import { extractPdfPages, extractPdfOutline, structurePdf } from './pdfbook.js';
import { parseHtmlBook, parseMarkdownBook, parseEpubBook, parseDocxBook } from './markup.js';
import { extractDeckFromPdf, parsePptxDeck, parseMarkdownDeck, parseHtmlDeck } from './decks.js';

export const BOOK_FORMATS = ['pdf', 'epub', 'docx', 'html', 'htm', 'md', 'markdown', 'txt', 'zip'];
export const DECK_FORMATS = ['pdf', 'pptx', 'md', 'markdown', 'html', 'htm', 'zip'];

export function detectKind(name, bytes) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const head = bytes ? String.fromCharCode(...bytes.slice(0, 4)) : '';
  if (head === '%PDF') return 'pdf';
  if (head.startsWith('PK')) {
    if (ext === 'epub') return 'epub';
    if (ext === 'docx') return 'docx';
    if (ext === 'pptx') return 'pptx';
    return 'zip';
  }
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (ext === 'txt') return 'txt';
  return ext || 'unknown';
}

const dec = new TextDecoder();
const nameOf = (file) => file.name.replace(/\.[^.]+$/, '');

async function openPdf(buf) {
  const { openPdfData } = await import('../pdf.js');
  return openPdfData(buf);
}

/**
 * Parse a book file. Returns {book, meta:{kind, mode, available, pages?}, pdfCache?}
 * `prefer` selects the PDF structure mode: 'outline' | 'headings' | 'pages'.
 */
export async function parseBookFile(file, { onProgress, prefer } = {}) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const kind = detectKind(file.name, bytes);
  const name = nameOf(file);
  if (kind === 'pdf') {
    const doc = await openPdf(bytes.slice());
    const pages = await extractPdfPages(doc, onProgress);
    const outline = await extractPdfOutline(doc);
    const title = (await doc.getMetadata().catch(() => null))?.info?.Title?.trim() || name;
    const { book, mode, available } = structurePdf(pages, outline, title, prefer);
    return { book, meta: { kind, mode, available, pageCount: doc.numPages, title }, pdfCache: { pages, outline, title } };
  }
  if (kind === 'epub') return { book: await parseEpubBook(buf, name), meta: { kind } };
  if (kind === 'docx') return { book: await parseDocxBook(buf, name), meta: { kind } };
  if (kind === 'html') return { book: parseHtmlBook(dec.decode(buf), name), meta: { kind } };
  if (kind === 'md' || kind === 'txt') return { book: await parseMarkdownBook(dec.decode(buf), name), meta: { kind } };
  if (kind === 'zip') {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf);
    const entries = Object.values(zip.files).filter((f) => !f.dir && !/^__MACOSX|\/\./.test(f.name));
    const pick = (re) => entries.filter((f) => re.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    const order = [[/\.epub$/i, 'epub'], [/\.docx$/i, 'docx'], [/\.pdf$/i, 'pdf'], [/\.html?$/i, 'html'], [/\.(md|markdown)$/i, 'md']];
    for (const [re, k] of order) {
      const found = pick(re);
      if (!found.length) continue;
      if (k === 'md' && found.length > 1) {
        // a folder of chapter files: concatenate in name order
        const parts = [];
        for (const f of found) parts.push((await f.async('string')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''));
        return { book: await parseMarkdownBook(parts.join('\n\n'), name), meta: { kind: 'zip', inner: 'md', files: found.length } };
      }
      const inner = new File([await found[0].async('arraybuffer')], found[0].name.split('/').pop());
      const r = await parseBookFile(inner, { onProgress, prefer });
      return { ...r, meta: { ...r.meta, kind: 'zip', inner: r.meta.kind } };
    }
    throw new Error('The archive contains no book file (PDF, EPUB, DOCX, HTML or Markdown).');
  }
  throw new Error(`Unsupported book format ".${kind}". Use PDF, EPUB, DOCX, HTML, Markdown or ZIP.`);
}

/** Re-structure a PDF book from its cached page lines without re-reading the file. */
export function restructurePdf(pdfCache, prefer) {
  return structurePdf(pdfCache.pages, pdfCache.outline, pdfCache.title, prefer);
}

/** Parse a slides file. Returns an array of decks: [{name, kind, slides, blob}] */
export async function parseDeckFile(file, { onProgress } = {}) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const kind = detectKind(file.name, bytes);
  const name = nameOf(file);
  if (kind === 'pdf') { const doc = await openPdf(bytes.slice()); return [{ name, kind, slides: await extractDeckFromPdf(doc, onProgress), blob: new Blob([buf], { type: 'application/pdf' }) }]; }
  if (kind === 'pptx') return [{ name, kind, slides: await parsePptxDeck(buf), blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }) }];
  if (kind === 'md' || kind === 'txt') return [{ name, kind: 'md', slides: await parseMarkdownDeck(dec.decode(buf)), blob: new Blob([buf], { type: 'text/markdown' }) }];
  if (kind === 'html') return [{ name, kind, slides: parseHtmlDeck(dec.decode(buf)), blob: new Blob([buf], { type: 'text/html' }) }];
  if (kind === 'zip') {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf);
    const entries = Object.values(zip.files).filter((f) => !f.dir && /\.(pdf|pptx|md|html?)$/i.test(f.name) && !/^__MACOSX|\/\./.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    if (!entries.length) throw new Error('The archive contains no slide files (PDF, PPTX, Markdown or HTML).');
    const out = [];
    for (const e of entries) out.push(...(await parseDeckFile(new File([await e.async('arraybuffer')], e.name.split('/').pop()), { onProgress })));
    return out;
  }
  throw new Error(`Unsupported slides format ".${kind}". Use PDF, PPTX, Markdown, HTML or ZIP.`);
}
