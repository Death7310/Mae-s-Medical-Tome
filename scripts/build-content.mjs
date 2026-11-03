#!/usr/bin/env node
/**
 * Content pipeline for Mae's Medical Tome.
 *
 * Reads:   content/book.json, content/book/*.md, content/slides/<deck>/{deck.json,slides.md|slides.pdf,links.md}
 * Writes:  public/content/{book,decks,manifest}.json   (what the app loads)
 *          public/downloads/book.{pdf,epub,zip,html,md} (book formats)
 *          public/downloads/slides/<deck>.{pdf,pptx,html} + slides.zip
 *
 * PDF rendering uses Playwright's bundled Chromium. If Playwright is not
 * installed the PDF step is skipped with a warning and everything else
 * still builds.
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const OUT_CONTENT = path.join(ROOT, 'public', 'content');
const OUT_DL = path.join(ROOT, 'public', 'downloads');
const OUT_SLIDES = path.join(OUT_DL, 'slides');

const warn = (m) => console.warn(`  ! ${m}`);
const log = (m) => console.log(`  ${m}`);

// ---------------------------------------------------------------- helpers
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseFrontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: src.slice(m[0].length) };
}

function makeMarked() {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        return `<h${depth} id="${slugify(text)}">${inner}</h${depth}>\n`;
      },
    },
  });
  return marked;
}
const marked = makeMarked();
const md = (s) => marked.parse(s);

export function htmlToText(html) {
  return html
    .replace(/<\/(p|li|h[1-6]|tr|div|blockquote|section)>/gi, '$&\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const xhtmlify = (html) =>
  html.replace(/<(br|hr|img[^>]*?)(?<!\/)>/g, '<$1/>').replace(/&nbsp;/g, '&#160;');

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function sha256(p) { return createHash('sha256').update(await fs.readFile(p)).digest('hex'); }

// ---------------------------------------------------------------- book
/** Split a chapter body into sections at "## " headings. */
export function splitSections(body) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let cur = { title: null, lines: [] };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (cur.title !== null || cur.lines.some((l) => l.trim())) sections.push(cur);
      cur = { title: m[1], lines: [] };
    } else cur.lines.push(line);
  }
  sections.push(cur);
  return sections.map((s) => ({ title: s.title, markdown: s.lines.join('\n').trim() }));
}

async function buildBook() {
  const meta = JSON.parse(await fs.readFile(path.join(CONTENT, 'book.json'), 'utf8'));
  const chapters = [];
  const sectionIds = new Set();
  for (const [i, file] of meta.chapters.entries()) {
    const src = await fs.readFile(path.join(CONTENT, 'book', file), 'utf8');
    const { data, body } = parseFrontMatter(src);
    const chapterId = data.id || slugify(path.basename(file, '.md'));
    const title = data.title || chapterId;
    const sections = [];
    for (const sec of splitSections(body)) {
      const secTitle = sec.title ?? title;
      let id = slugify(secTitle);
      let n = 2;
      while (sections.some((s) => s.id === id)) id = `${slugify(secTitle)}-${n++}`;
      const html = sec.title ? `<h2 id="${id}">${md.call(marked, sec.title).replace(/^<p>|<\/p>\s*$/g, '')}</h2>\n${md(sec.markdown)}` : md(sec.markdown);
      const text = htmlToText(html);
      sections.push({ id, title: secTitle, html, text, words: text.split(/\s+/).filter(Boolean).length });
      sectionIds.add(`${chapterId}#${id}`);
    }
    chapters.push({
      id: chapterId,
      number: i + 1,
      title,
      file,
      markdown: body,
      sections,
      words: sections.reduce((a, s) => a + s.words, 0),
    });
  }
  return { meta, chapters, sectionIds };
}

function bookCss() {
  return `
  body{font-family:Georgia,"Times New Roman",serif;line-height:1.55;max-width:42em;margin:2em auto;padding:0 1.2em;color:#1b1b1b}
  h1{font-size:2em;margin-top:2.5em;page-break-before:always}
  h1.title{page-break-before:avoid;margin-top:0}
  h2{font-size:1.4em;margin-top:1.8em;border-bottom:1px solid #ccc;padding-bottom:.2em}
  h3{font-size:1.1em;margin-top:1.4em}
  table{border-collapse:collapse;margin:1em 0;font-size:.95em}
  th,td{border:1px solid #bbb;padding:.35em .6em;text-align:left;vertical-align:top}
  th{background:#f0f0f0}
  blockquote{margin:1em 0;padding:.4em 1em;border-left:4px solid #999;background:#f7f7f7;font-style:normal}
  .toc ol{padding-left:1.2em}
  .front{text-align:center;margin:4em 0 3em}
  .front .sub{color:#555}
  @media print{body{max-width:none;margin:0}}`;
}

function bookHtml(book) {
  const { meta, chapters } = book;
  const toc = chapters.map((c) => `<li><a href="#${c.id}">${escapeXml(c.title)}</a><ol>${c.sections.filter((s) => s.title !== c.title).map((s) => `<li><a href="#${c.id}--${s.id}">${escapeXml(s.title)}</a></li>`).join('')}</ol></li>`).join('\n');
  const body = chapters.map((c) => `<section class="chapter" id="${c.id}"><h1>Chapter ${c.number}. ${escapeXml(c.title)}</h1>\n${c.sections.map((s) => `<div class="section" id="${c.id}--${s.id}">${s.html}</div>`).join('\n')}</section>`).join('\n');
  return `<!doctype html><html lang="${meta.language || 'en'}"><head><meta charset="utf-8"><title>${escapeXml(meta.title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${bookCss()}</style></head><body>
<div class="front"><h1 class="title">${escapeXml(meta.title)}</h1><p class="sub">${escapeXml(meta.subtitle || '')}</p><p>${escapeXml(meta.author || '')}</p><p class="sub">${escapeXml(meta.edition || '')}</p></div>
<nav class="toc"><h2>Contents</h2><ol>${toc}</ol></nav>
${body}
</body></html>`;
}

async function buildEpub(book, outFile) {
  const { meta, chapters } = book;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const uid = `urn:uuid:${createHash('md5').update(meta.id + meta.title).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')}`;
  const css = bookCss();
  zip.file('OEBPS/style.css', css);
  const items = [];
  const spine = [];
  const navLis = [];
  const ncxPts = [];
  const page = (id, title, inner) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${meta.language || 'en'}" xml:lang="${meta.language || 'en'}"><head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body id="${id}">${inner}</body></html>`;
  zip.file('OEBPS/title.xhtml', page('title', meta.title, `<div class="front"><h1 class="title">${escapeXml(meta.title)}</h1><p class="sub">${escapeXml(meta.subtitle || '')}</p><p>${escapeXml(meta.author || '')}</p><p class="sub">${escapeXml(meta.edition || '')}</p></div>`));
  items.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`<itemref idref="title"/>`);
  for (const c of chapters) {
    const file = `ch-${String(c.number).padStart(2, '0')}.xhtml`;
    const inner = `<h1>Chapter ${c.number}. ${escapeXml(c.title)}</h1>\n${c.sections.map((s) => `<div class="section" id="${s.id}">${xhtmlify(s.html)}</div>`).join('\n')}`;
    zip.file(`OEBPS/${file}`, page(c.id, c.title, inner));
    items.push(`<item id="${c.id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${c.id}"/>`);
    navLis.push(`<li><a href="${file}">${escapeXml(c.title)}</a><ol>${c.sections.filter((s) => s.title !== c.title).map((s) => `<li><a href="${file}#${s.id}">${escapeXml(s.title)}</a></li>`).join('')}</ol></li>`);
    ncxPts.push(`<navPoint id="np-${c.id}" playOrder="${c.number + 1}"><navLabel><text>${escapeXml(c.title)}</text></navLabel><content src="${file}"/></navPoint>`);
  }
  zip.file('OEBPS/nav.xhtml', page('nav', 'Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navLis.join('')}</ol></nav>`));
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="2"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${escapeXml(meta.title)}</text></docTitle><navMap><navPoint id="np-title" playOrder="1"><navLabel><text>Title</text></navLabel><content src="title.xhtml"/></navPoint>${ncxPts.join('')}</navMap></ncx>`);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${meta.language || 'en'}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier><dc:title>${escapeXml(meta.title)}</dc:title><dc:creator>${escapeXml(meta.author || '')}</dc:creator><dc:language>${meta.language || 'en'}</dc:language>
<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${items.join('')}</manifest>
<spine toc="ncx">${spine.join('')}</spine></package>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
  await fs.writeFile(outFile, buf);
}

// ---------------------------------------------------------------- PDF via Playwright
let browserPromise = null;
async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    try {
      const { chromium } = await import('playwright');
      // Prefer a pre-installed Chromium when the environment points at one
      // (e.g. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers with a "chromium" link).
      const candidates = [process.env.TOME_CHROMIUM_PATH, process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium')].filter(Boolean);
      for (const exe of candidates) {
        if (await exists(exe)) { try { return await chromium.launch({ executablePath: exe }); } catch { /* fall through */ } }
      }
      return await chromium.launch();
    } catch (e) {
      warn(`Playwright/Chromium unavailable, PDF outputs skipped (${e.message.split('\n')[0]})`);
      warn('To enable: npm i -D playwright && npx playwright install chromium');
      return null;
    }
  })();
  return browserPromise;
}
async function htmlToPdf(html, outFile, pdfOpts) {
  const browser = await getBrowser();
  if (!browser) return false;
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: outFile, printBackground: true, ...pdfOpts });
  await page.close();
  return true;
}

// ---------------------------------------------------------------- slides
/** Parse a markdown slide into simple blocks for PPTX + text. */
export function parseSlideBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { blocks.push({ type: 'heading', level: m[1].length, text: m[2].trim() }); i++; continue; }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    if (/^(\s*)([-*]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (m = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(lines[i]))) {
        items.push({ text: m[3].trim(), ordered: /\d/.test(m[2]), indent: Math.floor(m[1].length / 2) });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||\s*([-*]|\d+[.)])\s)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    blocks.push({ type: 'para', text: para.join(' ') });
  }
  return blocks;
}
const plain = (s) => s.replace(/\*\*|__|`/g, '').replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1');

export function parseLinksMd(src) {
  const out = {};
  const body = src.replace(/<!--[\s\S]*?-->/g, '');
  const parts = body.split(/^##\s+Slide\s+(\d+)\s*$/im);
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    let block = parts[i + 1].trim();
    const sm = /^sections:\s*(.*)$/im.exec(block);
    const sections = sm ? sm[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (sm) block = block.replace(sm[0], '').trim();
    out[n] = { sections, markdown: block };
  }
  return out;
}

function slideDeckHtml(deck, slidesHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(deck.title)}</title><style>
  @page{size:13.333in 7.5in;margin:0}
  html,body{margin:0;padding:0;background:#fff}
  body{font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#15202b}
  .slide{box-sizing:border-box;width:13.333in;height:7.5in;padding:.7in .9in;page-break-after:always;break-after:page;display:flex;flex-direction:column;border-bottom:1px solid #ddd;position:relative;overflow:hidden}
  .slide:last-child{page-break-after:auto}
  .slide h1{font-size:44pt;margin:0 0 .25em;color:#0b3d5c;font-weight:700;line-height:1.1}
  .slide h2{font-size:28pt;margin:0 0 .4em;color:#2a6f97;font-weight:500}
  .slide p,.slide li{font-size:22pt;line-height:1.35;margin:.25em 0}
  .slide ul,.slide ol{margin:.3em 0;padding-left:1.1em}
  .slide table{border-collapse:collapse;font-size:20pt;margin:.4em 0}
  .slide th,.slide td{border:1px solid #9fb3c8;padding:.25em .6em;text-align:left}
  .slide th{background:#e3edf5}
  .slide strong{color:#0b3d5c}
  .num{position:absolute;right:.5in;bottom:.35in;font-size:12pt;color:#789}
  .deck{position:absolute;left:.9in;bottom:.35in;font-size:12pt;color:#789}
  .slide.title{justify-content:center;background:linear-gradient(135deg,#0b3d5c,#2a6f97);color:#fff}
  .slide.title h1,.slide.title h2,.slide.title p{color:#fff}
  @media screen{body{background:#555;padding:1em}.slide{margin:0 auto 1em;box-shadow:0 2px 10px rgba(0,0,0,.4)}}
  </style></head><body>${slidesHtml}</body></html>`;
}

async function buildPptx(deck, slides, outFile) {
  let PptxGenJS;
  try { ({ default: PptxGenJS } = await import('pptxgenjs')); } catch (e) { warn(`pptxgenjs unavailable, PPTX skipped (${e.message})`); return false; }
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = deck.title;
  for (const s of slides) {
    const slide = pptx.addSlide();
    const blocks = parseSlideBlocks(s.markdown);
    const heading = blocks.find((b) => b.type === 'heading');
    let y = 0.4;
    if (heading) {
      slide.addText(plain(heading.text), { x: 0.5, y, w: 9, h: 0.9, fontSize: 30, bold: true, color: '0B3D5C', fontFace: 'Calibri' });
      y += 1.0;
    }
    for (const b of blocks) {
      if (b === heading) continue;
      if (b.type === 'heading') { slide.addText(plain(b.text), { x: 0.5, y, w: 9, h: 0.6, fontSize: 20, color: '2A6F97' }); y += 0.65; }
      else if (b.type === 'para') { slide.addText(plain(b.text), { x: 0.5, y, w: 9, h: 0.6, fontSize: 18, color: '15202B' }); y += 0.65; }
      else if (b.type === 'list') {
        const h = Math.min(0.5 * b.items.length, 4.5);
        slide.addText(b.items.map((it) => ({ text: plain(it.text), options: { bullet: it.ordered ? { type: 'number' } : true, indentLevel: it.indent, breakLine: true } })), { x: 0.5, y, w: 9, h, fontSize: 18, color: '15202B', valign: 'top' });
        y += h + 0.1;
      } else if (b.type === 'table') {
        const rows = b.rows.map((r, ri) => r.map((c) => ({ text: plain(c), options: ri === 0 ? { bold: true, fill: { color: 'E3EDF5' } } : {} })));
        slide.addTable(rows, { x: 0.5, y, w: 9, fontSize: 16, border: { type: 'solid', color: '9FB3C8', pt: 1 }, color: '15202B' });
        y += 0.45 * b.rows.length + 0.2;
      }
    }
    slide.addText(`${deck.title}  ·  ${s.number}`, { x: 0.5, y: 5.25, w: 9, h: 0.3, fontSize: 9, color: '778899' });
  }
  await pptx.writeFile({ fileName: outFile });
  return true;
}

async function extractPdfText(file) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await fs.readFile(file));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let text = '';
      for (const it of tc.items) { text += it.str; if (it.hasEOL) text += '\n'; else text += ' '; }
      pages.push(text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim());
    }
    return pages;
  } catch (e) {
    warn(`Could not extract text from ${path.basename(file)}: ${e.message}`);
    return null;
  }
}

async function buildDecks(book) {
  const slidesRoot = path.join(CONTENT, 'slides');
  const decks = [];
  if (!(await exists(slidesRoot))) return decks;
  for (const dir of (await fs.readdir(slidesRoot, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    const dPath = path.join(slidesRoot, dir.name);
    const metaFile = path.join(dPath, 'deck.json');
    if (!(await exists(metaFile))) { warn(`skipping ${dir.name}: no deck.json`); continue; }
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    const id = meta.id || slugify(dir.name);
    const deck = { id, title: meta.title || id, lecturer: meta.lecturer || '', course: meta.course || '', source: meta.source || 'slides.md', slides: [], files: {} };
    log(`deck ${id}`);
    const src = path.join(dPath, deck.source);
    if (!(await exists(src))) { warn(`skipping ${id}: ${deck.source} not found`); continue; }

    if (deck.source.endsWith('.md')) {
      const raw = await fs.readFile(src, 'utf8');
      const slideMds = raw.split(/\r?\n---\r?\n/).map((s) => s.trim()).filter(Boolean);
      deck.slides = slideMds.map((markdown, i) => {
        const html = md(markdown);
        const blocks = parseSlideBlocks(markdown);
        const heading = blocks.find((b) => b.type === 'heading');
        return { number: i + 1, title: heading ? plain(heading.text) : `Slide ${i + 1}`, markdown, html, text: htmlToText(html) };
      });
      const deckHtml = slideDeckHtml(deck, deck.slides.map((s, i) => `<section class="slide${i === 0 ? ' title' : ''}">${s.html}<div class="deck">${escapeXml(deck.title)}</div><div class="num">${s.number} / ${deck.slides.length}</div></section>`).join('\n'));
      await fs.writeFile(path.join(OUT_SLIDES, `${id}.html`), deckHtml);
      deck.files.html = `downloads/slides/${id}.html`;
      if (await htmlToPdf(deckHtml, path.join(OUT_SLIDES, `${id}.pdf`), { width: '13.333in', height: '7.5in', preferCSSPageSize: true })) deck.files.pdf = `downloads/slides/${id}.pdf`;
      if (await buildPptx(deck, deck.slides, path.join(OUT_SLIDES, `${id}.pptx`))) deck.files.pptx = `downloads/slides/${id}.pptx`;
    } else if (deck.source.endsWith('.pdf')) {
      await fs.copyFile(src, path.join(OUT_SLIDES, `${id}.pdf`));
      deck.files.pdf = `downloads/slides/${id}.pdf`;
      const pages = (await extractPdfText(src)) || [];
      deck.slides = pages.map((text, i) => ({ number: i + 1, title: (text.split('\n')[0] || `Slide ${i + 1}`).slice(0, 80), text, html: '' }));
      if (!pages.length) warn(`${id}: no text extracted; suggestions will be unavailable for this deck`);
      const pptxSrc = path.join(dPath, deck.source.replace(/\.pdf$/, '.pptx'));
      if (await exists(pptxSrc)) { await fs.copyFile(pptxSrc, path.join(OUT_SLIDES, `${id}.pptx`)); deck.files.pptx = `downloads/slides/${id}.pptx`; }
    } else {
      warn(`skipping ${id}: unsupported source ${deck.source}`);
      continue;
    }

    // links + explanations
    const linksFile = path.join(dPath, 'links.md');
    const links = (await exists(linksFile)) ? parseLinksMd(await fs.readFile(linksFile, 'utf8')) : {};
    for (const s of deck.slides) {
      const l = links[s.number];
      s.sections = [];
      s.explanationHtml = '';
      if (!l) continue;
      for (const ref of l.sections) {
        if (book.sectionIds.has(ref)) s.sections.push(ref);
        else warn(`${id} slide ${s.number}: unknown section "${ref}"`);
      }
      s.explanationHtml = md(l.markdown);
    }
    for (const n of Object.keys(links)) if (Number(n) > deck.slides.length) warn(`${id}: links.md refers to slide ${n} but the deck has ${deck.slides.length}`);
    const linked = deck.slides.filter((s) => s.sections.length).length;
    log(`  ${deck.slides.length} slides, ${linked} linked to the book`);
    decks.push(deck);
  }
  return decks;
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  console.log('Building content…');
  await fs.rm(OUT_CONTENT, { recursive: true, force: true });
  await fs.rm(OUT_DL, { recursive: true, force: true });
  await fs.mkdir(OUT_CONTENT, { recursive: true });
  await fs.mkdir(OUT_SLIDES, { recursive: true });

  const book = await buildBook();
  log(`book: ${book.chapters.length} chapters, ${book.sectionIds.size} sections, ${book.chapters.reduce((a, c) => a + c.words, 0)} words`);
  if (process.argv.includes('--ids')) for (const id of book.sectionIds) console.log('    ' + id);

  // Book formats
  const html = bookHtml(book);
  await fs.writeFile(path.join(OUT_DL, 'book.html'), html);
  await fs.writeFile(path.join(OUT_DL, 'book.md'), `# ${book.meta.title}\n\n${book.chapters.map((c) => `# ${c.title}\n\n${c.markdown.trim()}`).join('\n\n')}\n`);
  await buildEpub(book, path.join(OUT_DL, 'book.epub'));
  const customPdf = path.join(CONTENT, 'book', 'book.pdf');
  const bookFiles = { html: 'downloads/book.html', md: 'downloads/book.md', epub: 'downloads/book.epub' };
  if (await exists(customPdf)) { await fs.copyFile(customPdf, path.join(OUT_DL, 'book.pdf')); bookFiles.pdf = 'downloads/book.pdf'; log('book.pdf: using content/book/book.pdf'); }
  else if (await htmlToPdf(html, path.join(OUT_DL, 'book.pdf'), { format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: `<div style="width:100%;text-align:center;font-size:9px;color:#777;font-family:Georgia,serif">${escapeXml(book.meta.title)} · <span class="pageNumber"></span></div>` })) bookFiles.pdf = 'downloads/book.pdf';
  {
    const zip = new JSZip();
    zip.file(`${book.meta.id}/book.json`, JSON.stringify(book.meta, null, 2));
    for (const c of book.chapters) zip.file(`${book.meta.id}/markdown/${c.file}`, await fs.readFile(path.join(CONTENT, 'book', c.file)));
    zip.file(`${book.meta.id}/book.html`, html);
    zip.file(`${book.meta.id}/book.epub`, await fs.readFile(path.join(OUT_DL, 'book.epub')));
    if (bookFiles.pdf) zip.file(`${book.meta.id}/book.pdf`, await fs.readFile(path.join(OUT_DL, 'book.pdf')));
    await fs.writeFile(path.join(OUT_DL, 'book.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    bookFiles.zip = 'downloads/book.zip';
  }

  // Decks
  const decks = await buildDecks(book);
  if (decks.length) {
    const zip = new JSZip();
    for (const d of decks) for (const [k, rel] of Object.entries(d.files)) zip.file(`slides/${d.id}.${k}`, await fs.readFile(path.join(ROOT, 'public', rel)));
    await fs.writeFile(path.join(OUT_DL, 'slides.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  }
  const b = await browserPromise; if (b) await b.close();

  // App JSON
  const bookOut = {
    ...book.meta,
    chapters: book.chapters.map((c) => ({ id: c.id, number: c.number, title: c.title, words: c.words, sections: c.sections.map((s) => ({ id: s.id, title: s.title, html: s.html, text: s.text, words: s.words })) })),
  };
  await fs.writeFile(path.join(OUT_CONTENT, 'book.json'), JSON.stringify(bookOut));
  await fs.writeFile(path.join(OUT_CONTENT, 'decks.json'), JSON.stringify({ decks: decks.map((d) => ({ ...d, slides: d.slides.map(({ markdown, ...s }) => s) })) }));

  const fileEntry = async (label, rel, kind) => {
    const p = path.join(ROOT, 'public', rel);
    const st = await fs.stat(p);
    return { label, kind, path: rel, bytes: st.size, sha256: await sha256(p) };
  };
  const files = [];
  const labels = { pdf: 'PDF', epub: 'EPUB', zip: 'ZIP (all formats + Markdown)', html: 'HTML (single page)', md: 'Markdown' };
  for (const k of ['pdf', 'epub', 'zip', 'html', 'md']) if (bookFiles[k]) files.push(await fileEntry(labels[k], bookFiles[k], 'book'));
  for (const d of decks) {
    for (const k of ['pdf', 'pptx', 'html']) if (d.files[k]) files.push({ ...(await fileEntry(k.toUpperCase(), d.files[k], 'deck')), deck: d.id, deckTitle: d.title });
  }
  if (decks.length) files.push(await fileEntry('All decks (ZIP)', 'downloads/slides.zip', 'decks'));
  const contentHash = createHash('sha256').update(JSON.stringify(bookOut) + JSON.stringify(decks.map((d) => d.id + d.slides.length))).digest('hex').slice(0, 12);
  await fs.writeFile(path.join(OUT_CONTENT, 'manifest.json'), JSON.stringify({ builtAt: new Date().toISOString(), contentHash, book: { title: book.meta.title, chapters: book.chapters.length, sections: book.sectionIds.size }, decks: decks.map((d) => ({ id: d.id, title: d.title, slides: d.slides.length })), files }, null, 2));
  log(`${files.length} download files written`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
