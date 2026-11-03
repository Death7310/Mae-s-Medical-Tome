/** Shared helpers for turning raw file text into a book structure. Pure. */
export const slug = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
export const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function htmlToText(html) {
  return String(html)
    .replace(/<\/(p|li|h[1-6]|tr|div|blockquote|section|br)>/gi, '$&\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Paragraph HTML from plain text (blank line or newline separated). */
export function textToHtml(text) {
  return String(text).split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
}

/**
 * Split an over-long section into parts of roughly `target` words at sentence
 * boundaries so that slide linking and practice stay focused.
 */
export function splitLong(text, target = 700, max = 1100) {
  const w = words(text);
  if (w <= max) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts = [];
  let cur = '';
  for (const s of sentences) {
    if (words(cur) + words(s) > target && cur) { parts.push(cur.trim()); cur = ''; }
    cur += (cur ? ' ' : '') + s;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * Normalise a list of {chapterTitle, sectionTitle, text, html?, page?} rows
 * into the book shape the app uses, with deterministic ids so that the same
 * file parsed on two devices yields the same ids (sync depends on it).
 */
export function assembleBook(title, rows, { splitWords = 1100 } = {}) {
  const chapters = [];
  let ch = null;
  for (const r of rows) {
    if (!ch || ch.title !== r.chapterTitle) {
      ch = { title: r.chapterTitle || `Chapter ${chapters.length + 1}`, sections: [], page: r.page };
      chapters.push(ch);
    }
    const parts = splitLong(r.text || '', 700, splitWords);
    parts.forEach((text, i) => {
      if (!text.trim() && !r.sectionTitle) return;
      ch.sections.push({ title: (r.sectionTitle || ch.title) + (parts.length > 1 ? ` (part ${i + 1})` : ''), text, html: parts.length > 1 || !r.html ? textToHtml(text) : r.html, page: r.page });
    });
  }
  const usedCh = new Set();
  chapters.forEach((c, ci) => {
    let id = slug(c.title); if (usedCh.has(id)) id = `${id}-${ci + 1}`; usedCh.add(id);
    c.id = id; c.number = ci + 1;
    const used = new Set();
    c.sections.forEach((s, si) => {
      let sid = slug(s.title); if (used.has(sid)) sid = `${sid}-${si + 1}`; used.add(sid);
      s.id = sid; s.words = words(s.text);
    });
    c.words = c.sections.reduce((a, s) => a + s.words, 0);
  });
  let out = chapters.filter((c) => c.sections.length);
  // title pages, part dividers, dedications: a "chapter" with almost no text is not a chapter
  if (out.length > 2) out = out.filter((c) => c.words >= 50);
  out.forEach((c, i) => { c.number = i + 1; });
  return { title: title || 'Untitled book', chapters: out };
}
