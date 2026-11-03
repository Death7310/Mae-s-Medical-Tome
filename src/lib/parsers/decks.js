/** Slide decks: PDF (text per page), PPTX (text per slide), Markdown, HTML. */
import { parseDom } from './markup.js';
import { htmlToText } from './text.js';

export async function extractDeckFromPdf(doc, onProgress) {
  const slides = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = '', best = { size: 0, text: '' }, cur = '';
    let curSize = 0;
    const flushLine = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) { text += t + '\n'; if (curSize > best.size && /[a-z]/i.test(t)) best = { size: curSize, text: t }; } cur = ''; curSize = 0; };
    for (const it of tc.items) { if (!('str' in it)) continue; cur += (cur && !cur.endsWith(' ') ? ' ' : '') + it.str; curSize = Math.max(curSize, Math.hypot(it.transform[2], it.transform[3]) || it.height || 0); if (it.hasEOL) flushLine(); }
    flushLine();
    slides.push({ number: p, title: (best.text || text.split('\n')[0] || `Slide ${p}`).slice(0, 90), text: text.trim() });
    if (onProgress) await onProgress(p, doc.numPages);
  }
  return slides;
}

/** Text of one PPTX slide XML: paragraphs separated by newlines, title from the title placeholder. */
export function pptxSlideText(xml) {
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');
  const shapes = xml.split(/<p:sp\b/).slice(1);
  let title = '';
  const paras = [];
  for (const sp of shapes) {
    const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(sp);
    const ps = [...sp.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((m) => decode([...m[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => x[1]).join('')).trim()).filter(Boolean);
    if (isTitle && !title) title = ps.join(' ');
    else paras.push(...ps);
  }
  if (!title && paras.length) title = paras[0];
  return { title: title.slice(0, 90), text: [title, ...paras.filter((p) => p !== title)].filter(Boolean).join('\n') };
}

export async function parsePptxDeck(arrayBuffer) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(/slide(\d+)/.exec(a)[1]) - Number(/slide(\d+)/.exec(b)[1]));
  if (!files.length) throw new Error('No slides found in this PowerPoint file');
  const slides = [];
  for (const [i, f] of files.entries()) {
    const { title, text } = pptxSlideText(await zip.file(f).async('string'));
    slides.push({ number: i + 1, title: title || `Slide ${i + 1}`, text });
  }
  return slides;
}

export async function parseMarkdownDeck(text) {
  const { marked } = await import('marked');
  return text.split(/\r?\n---\r?\n/).map((md, i) => ({ number: i + 1, title: (/^#{1,3}\s+(.+)$/m.exec(md) || [])[1]?.replace(/[*_`]/g, '') || `Slide ${i + 1}`, text: htmlToText(marked.parse(md)), html: marked.parse(md) })).filter((s) => s.text.trim());
}

export function parseHtmlDeck(html) {
  const doc = parseDom(html);
  let nodes = [...doc.querySelectorAll('section.slide, section, .slide')];
  if (!nodes.length) nodes = [doc.body];
  return nodes.map((n, i) => ({ number: i + 1, title: n.querySelector('h1,h2,h3')?.textContent?.trim() || `Slide ${i + 1}`, text: htmlToText(n.innerHTML), html: n.innerHTML })).filter((s) => s.text.trim());
}
