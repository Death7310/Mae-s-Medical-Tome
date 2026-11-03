/** HTML, Markdown, EPUB and DOCX books → book structure. Uses DOMParser (browser; linkedom in tests). */
import { assembleBook, htmlToText } from './text.js';

export function parseDom(html) {
  return new globalThis.DOMParser().parseFromString(html, 'text/html');
}

function clean(el) {
  for (const n of el.querySelectorAll('script,style,nav,header,footer,iframe,svg,img,picture,video,audio,button,form')) n.remove();
  for (const n of el.querySelectorAll('*')) for (const a of [...n.attributes]) if (/^on|style|class|id|srcset|data-/.test(a.name) || (a.name === 'href' && !/^#|^https?:/.test(a.value))) n.removeAttribute(a.name);
  return el;
}

/**
 * Split a DOM body into rows at heading levels. Chapter level = the highest
 * heading level present (h1 if any, else h2…); section level = the next one.
 */
export function rowsFromDom(doc, fallbackTitle) {
  const body = clean(doc.body || doc.documentElement);
  const levels = [1, 2, 3, 4].filter((l) => body.querySelector(`h${l}`));
  const chL = levels[0], secL = levels[1];
  const rows = [];
  let chapterTitle = fallbackTitle, sectionTitle = null, html = '';
  const flush = () => { const text = htmlToText(html); if (text.trim()) rows.push({ chapterTitle: chapterTitle || fallbackTitle, sectionTitle: sectionTitle || chapterTitle || fallbackTitle, text, html }); html = ''; };
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      const m = /^h([1-6])$/.exec(tag);
      if (m) {
        const l = Number(m[1]);
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (l === chL) { flush(); chapterTitle = t; sectionTitle = null; continue; }
        if (l === secL) { flush(); sectionTitle = t; continue; }
        html += `<h3>${t}</h3>`; continue;
      }
      if (['div', 'section', 'article', 'main', 'body'].includes(tag) && el.querySelector('h1,h2,h3,h4')) { walk(el); continue; }
      html += el.outerHTML;
    }
  };
  walk(body);
  flush();
  return rows;
}

export function parseHtmlBook(htmlString, name) {
  const doc = parseDom(htmlString);
  const title = doc.querySelector('title')?.textContent?.trim() || doc.querySelector('h1')?.textContent?.trim() || name;
  return assembleBook(title, rowsFromDom(doc, title));
}

export async function parseMarkdownBook(text, name) {
  const { marked } = await import('marked');
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const html = marked.parse(body, { gfm: true });
  const title = (/^#\s+(.+)$/m.exec(body) || [])[1] || name;
  return parseHtmlBook(`<html><head><title>${title}</title></head><body>${html}</body></html>`, name);
}

export async function parseEpubBook(arrayBuffer, name) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = /full-path="([^"]+)"/.exec(container || '')?.[1] || Object.keys(zip.files).find((f) => f.endsWith('.opf'));
  if (!opfPath) throw new Error('Not a valid EPUB (no package file)');
  const opf = await zip.file(opfPath).async('string');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const title = /<dc:title[^>]*>([^<]+)</.exec(opf)?.[1]?.trim() || name;
  const items = new Map();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1], href = /\bhref="([^"]+)"/.exec(m[0])?.[1], type = /media-type="([^"]+)"/.exec(m[0])?.[1];
    if (id && href) items.set(id, { href: decodeURIComponent(href), type });
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => items.get(m[1])).filter((i) => i && /html|xml/.test(i.type || 'html'));
  const rows = [];
  let chapterCount = 0;
  for (const it of spine) {
    const file = zip.file(base + it.href) || zip.file(it.href);
    if (!file) continue;
    const html = await file.async('string');
    const doc = parseDom(html);
    const body = doc.body || doc.documentElement;
    const text = body.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 200 && !body.querySelector('h1,h2')) continue; // cover, title page, blank
    const h1 = body.querySelector('h1,h2');
    const chapterTitle = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : (doc.querySelector('title')?.textContent?.trim() || `Chapter ${++chapterCount}`);
    const sub = rowsFromDom(doc, chapterTitle);
    for (const r of sub) rows.push({ ...r, chapterTitle: sub.length && sub[0].chapterTitle !== chapterTitle && /^h1$/i.test(h1?.tagName || '') ? r.chapterTitle : chapterTitle });
  }
  return assembleBook(title, rows);
}

export async function parseDocxBook(arrayBuffer, name) {
  const mammoth = await import('mammoth');
  const res = await (mammoth.default || mammoth).convertToHtml({ arrayBuffer });
  return parseHtmlBook(`<html><head><title>${name}</title></head><body>${res.value}</body></html>`, name);
}
