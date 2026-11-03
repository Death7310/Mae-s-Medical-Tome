/**
 * PDF book structure detection. Pure functions operate on `pages`:
 *   pages = [ [ [text, fontSize, gapBefore], ... ], ... ]   (one array per page)
 * produced by extractPdfPages() (pdf.js, browser or Node legacy build).
 *
 * Three strategies, in order of trust:
 *   outline  - the PDF's own bookmarks (exact when present)
 *   headings - font-size tiers: largest recurring size = chapters, next = sections
 *   pages    - fixed page groups (always works, least meaningful)
 */
import { assembleBook, words } from './text.js';

export async function extractPdfPages(doc, onProgress) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    let cur = null, lastY = null, lastEndX = null;
    const flush = () => { if (cur && cur.text.trim()) lines.push([cur.text.replace(/\s+/g, ' ').trim(), Math.round(cur.size * 2) / 2, cur.gap]); cur = null; };
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;
      const y = it.transform[5], x = it.transform[4];
      const newLine = cur && lastY !== null && Math.abs(y - lastY) > Math.max(size, cur.size) * 0.45;
      if (newLine) { const gap = lastY - y > Math.max(size, cur.size) * 1.7; flush(); cur = { text: '', size: 0, gap }; }
      if (!cur) cur = { text: '', size: 0, gap: lines.length === 0 };
      const needSpace = cur.text && !cur.text.endsWith(' ') && !it.str.startsWith(' ') && lastEndX !== null && x - lastEndX > size * 0.12;
      cur.text += (needSpace ? ' ' : '') + it.str;
      cur.size = Math.max(cur.size, size);
      lastY = y; lastEndX = x + (it.width || 0);
      if (it.hasEOL) { flush(); lastEndX = null; }
    }
    flush();
    pages.push(lines);
    page.cleanup?.();
    if (onProgress) await onProgress(p, doc.numPages);
  }
  return pages;
}

/** Bookmarks → [{title, depth, page}] (1-based pages), or null. */
export async function extractPdfOutline(doc) {
  let outline;
  try { outline = await doc.getOutline(); } catch { return null; }
  if (!outline?.length) return null;
  const out = [];
  const walk = async (items, depth) => {
    for (const it of items) {
      let page = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0] !== undefined) page = typeof dest[0] === 'object' && dest[0] !== null ? (await doc.getPageIndex(dest[0])) + 1 : Number(dest[0]) + 1;
      } catch { /* unresolved destination */ }
      out.push({ title: String(it.title || '').replace(/\s+/g, ' ').trim(), depth, page });
      if (it.items?.length && depth < 2) await walk(it.items, depth + 1);
    }
  };
  await walk(outline, 1);
  const withPages = out.filter((e) => e.page && e.title);
  return withPages.length >= 2 ? withPages : null;
}

const isNoise = (t) => !/[a-z]/i.test(t) || /^(\d+|[ivxlc]+|page \d+|\d+ of \d+)$/i.test(t.trim());

/** Join lines of a page range into paragraph text, fixing hyphenation. */
export function linesToText(lines) {
  let out = '';
  for (const [text, , gap] of lines) {
    if (!text) continue;
    if (!out) { out = text; continue; }
    if (gap) out += '\n\n' + text;
    else if (/[A-Za-z]-$/.test(out)) out = out.slice(0, -1) + text;
    else out += ' ' + text;
  }
  return out.trim();
}

/** Running heads and footers are short lines that repeat on many pages; page numbers vary, so digits are normalised. */
export const headKey = (t) => (words(t) <= 10 ? t.replace(/\d+/g, '#') : t).toLowerCase();
export function runningHeads(pages) {
  const counts = new Map();
  for (const page of pages) for (const [t] of page.slice(0, 3).concat(page.slice(-3))) { if (words(t) > 12) continue; const k = headKey(t); counts.set(k, (counts.get(k) || 0) + 1); }
  const threshold = Math.max(3, pages.length * 0.25);
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k));
}

export function bodyFontSize(pages) {
  const weight = new Map();
  for (const page of pages) for (const [t, s] of page) weight.set(s, (weight.get(s) || 0) + t.length);
  let best = 0, bestW = -1;
  for (const [s, w] of weight) if (w > bestW) { best = s; bestW = w; }
  return best || 10;
}

/** Heading candidates by font-size tier. Returns {chapterSize, sectionSize, body}. */
export function headingTiers(pages) {
  const body = bodyFontSize(pages);
  const heads = runningHeads(pages);
  const counts = new Map();
  for (const page of pages) for (const [t, s] of page) {
    if (s < body * 1.12 || isNoise(t) || words(t) > 16 || heads.has(headKey(t))) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const sizes = [...counts].sort((a, b) => b[0] - a[0]);
  const nPages = pages.length;
  // chapters: the largest size that recurs but not on most pages; sections: the next size with more entries
  let chapterSize = null, sectionSize = null;
  for (const [s, n] of sizes) {
    if (!chapterSize) { if (n >= 2 && n <= Math.max(4, nPages * 0.6)) chapterSize = s; continue; }
    if (n >= 2 && n <= nPages * 4) { sectionSize = s; break; }
  }
  if (!chapterSize && sizes.length) chapterSize = sizes[0][0];
  return { body, chapterSize, sectionSize, heads };
}

export function structureFromHeadings(pages, title) {
  const { body, chapterSize, sectionSize, heads } = headingTiers(pages);
  if (!chapterSize) return null;
  const rows = [];
  let chapterTitle = null, sectionTitle = null, buf = [], page0 = 1;
  const flush = () => { const text = linesToText(buf); if (text.trim() || sectionTitle) rows.push({ chapterTitle: chapterTitle || 'Front matter', sectionTitle: sectionTitle || chapterTitle || 'Front matter', text, page: page0 }); buf = []; };
  pages.forEach((lines, pi) => {
    for (const line of lines) {
      const [t, s] = line;
      if (heads.has(headKey(t)) && s <= body * 1.12) continue;
      const isCh = Math.abs(s - chapterSize) < 0.26 && !isNoise(t) && words(t) <= 16;
      const isSec = sectionSize && Math.abs(s - sectionSize) < 0.26 && !isNoise(t) && words(t) <= 16;
      if (isCh) { flush(); chapterTitle = t; sectionTitle = null; page0 = pi + 1; continue; }
      if (isSec) { flush(); sectionTitle = t; page0 = pi + 1; continue; }
      if (s >= body * 1.12 && !isNoise(t) && words(t) <= 16 && !sectionSize) { flush(); sectionTitle = t; page0 = pi + 1; continue; }
      buf.push(line);
    }
  });
  flush();
  // merge consecutive heading-only rows (a chapter heading immediately followed by its first section heading)
  const merged = rows.filter((r, i) => r.text.trim() || !(rows[i + 1] && rows[i + 1].chapterTitle === r.chapterTitle));
  const chapters = new Set(merged.map((r) => r.chapterTitle));
  if (chapters.size < 2 && merged.length < 3) return null;
  return assembleBook(title, merged);
}

export function structureFromOutline(pages, outline, title) {
  const top = outline.filter((e) => e.depth === 1);
  if (top.length < 2) return null;
  const rows = [];
  const entries = outline.map((e, i) => ({ ...e, end: (outline.slice(i + 1).find((x) => x.depth <= e.depth)?.page || pages.length + 1) }));
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.depth !== 1) continue;
    const subs = [];
    for (let j = i + 1; j < entries.length && entries[j].depth > 1; j++) subs.push(entries[j]);
    if (!subs.length) {
      const text = linesToText(pages.slice(e.page - 1, e.end - 1).flat());
      rows.push({ chapterTitle: e.title, sectionTitle: e.title, text, page: e.page });
    } else {
      // chapter text before the first sub-heading
      if (subs[0].page > e.page) rows.push({ chapterTitle: e.title, sectionTitle: `${e.title}: introduction`, text: linesToText(pages.slice(e.page - 1, subs[0].page - 1).flat()), page: e.page });
      subs.forEach((s, k) => {
        const endPage = subs[k + 1]?.page || e.end;
        rows.push({ chapterTitle: e.title, sectionTitle: s.title, text: linesToText(pages.slice(s.page - 1, Math.max(endPage - 1, s.page)).flat()), page: s.page });
      });
    }
  }
  return assembleBook(title, rows, { splitWords: 1400 });
}

export function structureFromPages(pages, title, per = 2, chapterEvery = 20) {
  const rows = [];
  for (let p = 0; p < pages.length; p += per) {
    const chStart = Math.floor(p / chapterEvery) * chapterEvery + 1;
    const chEnd = Math.min(chStart + chapterEvery - 1, pages.length);
    rows.push({ chapterTitle: `Pages ${chStart}–${chEnd}`, sectionTitle: per === 1 ? `Page ${p + 1}` : `Pages ${p + 1}–${Math.min(p + per, pages.length)}`, text: linesToText(pages.slice(p, p + per).flat()), page: p + 1 });
  }
  return assembleBook(title, rows, { splitWords: 1400 });
}

/** Pick the best structure. Returns {book, mode, available:[modes]}. */
export function structurePdf(pages, outline, title, prefer) {
  const options = {};
  if (outline) { const b = structureFromOutline(pages, outline, title); if (b && b.chapters.length) options.outline = b; }
  const h = structureFromHeadings(pages, title); if (h && h.chapters.length) options.headings = h;
  options.pages = structureFromPages(pages, title);
  const order = [prefer, 'outline', 'headings', 'pages'].filter(Boolean);
  const mode = order.find((m) => options[m]);
  return { book: options[mode], mode, available: Object.keys(options) };
}
